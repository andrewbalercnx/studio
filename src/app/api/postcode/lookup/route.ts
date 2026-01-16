import { NextRequest, NextResponse } from 'next/server';

/**
 * Response format from getAddress.io Autocomplete API
 */
type AutocompleteResponse = {
  suggestions: AutocompleteSuggestion[];
};

type AutocompleteSuggestion = {
  address: string;
  url: string;
  id: string;
};

/**
 * Response format from getAddress.io Get API (full address details)
 */
type GetAddressResponse = {
  postcode: string;
  latitude: number;
  longitude: number;
  formatted_address: string[];
  thoroughfare: string;
  building_name: string;
  sub_building_name: string;
  sub_building_number: string;
  building_number: string;
  line_1: string;
  line_2: string;
  line_3: string;
  line_4: string;
  locality: string;
  town_or_city: string;
  county: string;
  district: string;
  country: string;
  residential: boolean;
};

/**
 * Simplified address format returned to the client
 */
export type PostcodeLookupAddress = {
  id: string;
  displayAddress: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  postalCode: string;
  country: string;
};

export type PostcodeLookupResponse = {
  ok: boolean;
  postcode?: string;
  addresses?: PostcodeLookupAddress[];
  error?: string;
};

/**
 * GET /api/postcode/lookup?postcode=SW1A1AA
 *
 * Looks up addresses at a UK postcode using getAddress.io API.
 * Returns a list of addresses that the user can select from.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const postcode = searchParams.get('postcode');

  if (!postcode) {
    return NextResponse.json<PostcodeLookupResponse>(
      { ok: false, error: 'Postcode is required' },
      { status: 400 }
    );
  }

  // Clean up the postcode (remove spaces, uppercase)
  const cleanPostcode = postcode.replace(/\s+/g, '').toUpperCase();

  // Validate postcode format (basic UK postcode pattern - no spaces since we cleaned it)
  // Also allow getAddress.io test postcodes (XX2 00X, XX4 04X, etc.)
  const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i;
  const testPostcodePattern = /^XX\d\d\d[A-Z]$/i;
  if (!postcodePattern.test(cleanPostcode) && !testPostcodePattern.test(cleanPostcode)) {
    return NextResponse.json<PostcodeLookupResponse>(
      { ok: false, error: 'Invalid UK postcode format' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GETADDRESS_API_KEY;
  if (!apiKey) {
    console.error('[postcode/lookup] GETADDRESS_API_KEY not configured');
    return NextResponse.json<PostcodeLookupResponse>(
      { ok: false, error: 'Postcode lookup service not configured' },
      { status: 500 }
    );
  }

  // Log API key diagnostics (length and first/last chars only)
  console.log(`[postcode/lookup] API key present: length=${apiKey.length}, starts=${apiKey.substring(0, 4)}, ends=${apiKey.substring(apiKey.length - 4)}`);

  try {
    // Step 1: Call getAddress.io Autocomplete API to get address suggestions
    const autocompleteUrl = `https://api.getAddress.io/autocomplete/${cleanPostcode}?api-key=${apiKey}`;
    console.log(`[postcode/lookup] Fetching autocomplete: ${autocompleteUrl.replace(apiKey, 'API_KEY_HIDDEN')}`);

    const autocompleteResponse = await fetch(autocompleteUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log(`[postcode/lookup] Autocomplete response status: ${autocompleteResponse.status} for postcode: ${cleanPostcode}`);

    if (!autocompleteResponse.ok) {
      const errorBody = await autocompleteResponse.text();
      console.error(`[postcode/lookup] Autocomplete error response body: ${errorBody}`);

      if (autocompleteResponse.status === 404) {
        return NextResponse.json<PostcodeLookupResponse>(
          { ok: false, error: 'No addresses found for this postcode. Please enter address manually.' },
          { status: 404 }
        );
      }
      if (autocompleteResponse.status === 401) {
        console.error('[postcode/lookup] Invalid API key');
        return NextResponse.json<PostcodeLookupResponse>(
          { ok: false, error: 'Postcode lookup service configuration error' },
          { status: 500 }
        );
      }
      if (autocompleteResponse.status === 429) {
        return NextResponse.json<PostcodeLookupResponse>(
          { ok: false, error: 'Too many requests. Please try again later.' },
          { status: 429 }
        );
      }
      throw new Error(`getAddress.io autocomplete returned status ${autocompleteResponse.status}: ${errorBody}`);
    }

    const autocompleteData: AutocompleteResponse = await autocompleteResponse.json();
    console.log(`[postcode/lookup] Found ${autocompleteData.suggestions?.length || 0} suggestions`);

    if (!autocompleteData.suggestions || autocompleteData.suggestions.length === 0) {
      return NextResponse.json<PostcodeLookupResponse>(
        { ok: false, error: 'No addresses found for this postcode. Please enter address manually.' },
        { status: 404 }
      );
    }

    // Format the postcode with space (e.g., "SW1A 1AA")
    const formattedPostcode = formatPostcode(cleanPostcode);

    // Step 2: Fetch full details for each suggestion (limited to first 10 to avoid rate limits)
    const limitedSuggestions = autocompleteData.suggestions.slice(0, 10);
    const addresses: PostcodeLookupAddress[] = [];

    for (const suggestion of limitedSuggestions) {
      try {
        const getUrl = `https://api.getAddress.io/get/${suggestion.id}?api-key=${apiKey}`;
        const getResponse = await fetch(getUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        if (getResponse.ok) {
          const addr: GetAddressResponse = await getResponse.json();

          // Build line1 from building info
          let line1 = '';
          if (addr.sub_building_name) line1 += addr.sub_building_name + ', ';
          if (addr.building_name) line1 += addr.building_name + ', ';
          if (addr.building_number) line1 += addr.building_number + ' ';
          if (addr.sub_building_number) line1 += addr.sub_building_number + ' ';
          line1 += addr.thoroughfare || addr.line_1;
          line1 = line1.trim().replace(/,\s*$/, '');

          // Use line_2 or locality for line2
          const line2 = addr.line_2 || addr.locality || '';

          addresses.push({
            id: suggestion.id,
            displayAddress: suggestion.address,
            line1: line1 || addr.line_1,
            line2,
            city: addr.town_or_city,
            county: addr.county || addr.district || '',
            postalCode: formattedPostcode,
            country: 'GB',
          });
        }
      } catch (err) {
        console.error(`[postcode/lookup] Error fetching address ${suggestion.id}:`, err);
        // Continue with other addresses
      }
    }

    if (addresses.length === 0) {
      return NextResponse.json<PostcodeLookupResponse>(
        { ok: false, error: 'Failed to retrieve address details. Please enter address manually.' },
        { status: 500 }
      );
    }

    return NextResponse.json<PostcodeLookupResponse>({
      ok: true,
      postcode: formattedPostcode,
      addresses,
    });
  } catch (error) {
    console.error('[postcode/lookup] Error:', error);
    return NextResponse.json<PostcodeLookupResponse>(
      { ok: false, error: 'Failed to lookup postcode' },
      { status: 500 }
    );
  }
}

/**
 * Format a postcode with proper spacing (e.g., "SW1A1AA" -> "SW1A 1AA")
 */
function formatPostcode(postcode: string): string {
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  // UK postcodes have the last 3 characters as "inward code"
  if (clean.length >= 5) {
    return clean.slice(0, -3) + ' ' + clean.slice(-3);
  }
  return clean;
}
