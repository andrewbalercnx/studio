import { NextRequest, NextResponse } from 'next/server';

/**
 * Response format from getAddress.io Find API
 */
type GetAddressResponse = {
  postcode: string;
  latitude: number;
  longitude: number;
  addresses: GetAddressEntry[];
};

type GetAddressEntry = {
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

  try {
    // Call getAddress.io Find API
    const url = `https://api.getAddress.io/find/${cleanPostcode}?api-key=${apiKey}&expand=true`;
    console.log(`[postcode/lookup] Fetching: ${url.replace(apiKey, 'API_KEY_HIDDEN')}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log(`[postcode/lookup] Response status: ${response.status} for postcode: ${cleanPostcode}`);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[postcode/lookup] Error response body: ${errorBody}`);

      if (response.status === 404) {
        console.error(`[postcode/lookup] 404 for postcode ${cleanPostcode} - may be trial API key limitation or postcode not in database`);
        return NextResponse.json<PostcodeLookupResponse>(
          { ok: false, error: 'No addresses found for this postcode. Please enter address manually.' },
          { status: 404 }
        );
      }
      if (response.status === 401) {
        console.error('[postcode/lookup] Invalid API key');
        return NextResponse.json<PostcodeLookupResponse>(
          { ok: false, error: 'Postcode lookup service configuration error' },
          { status: 500 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json<PostcodeLookupResponse>(
          { ok: false, error: 'Too many requests. Please try again later.' },
          { status: 429 }
        );
      }
      throw new Error(`getAddress.io returned status ${response.status}: ${errorBody}`);
    }

    const data: GetAddressResponse = await response.json();

    // Format the postcode with space (e.g., "SW1A 1AA")
    const formattedPostcode = formatPostcode(cleanPostcode);

    // Transform addresses to our format
    const addresses: PostcodeLookupAddress[] = data.addresses.map((addr, index) => {
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

      // Build display address
      const displayParts = [line1];
      if (line2) displayParts.push(line2);
      displayParts.push(addr.town_or_city);
      const displayAddress = displayParts.join(', ');

      return {
        id: `addr_${index}`,
        displayAddress,
        line1: line1 || addr.line_1,
        line2,
        city: addr.town_or_city,
        county: addr.county || addr.district || '',
        postalCode: formattedPostcode,
        country: 'GB',
      };
    });

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
