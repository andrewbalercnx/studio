import type { MxJdfDocument } from './mxjdf-builder';

/**
 * Mixam API Client
 * Handles authentication and API calls to Mixam
 *
 * MOCK MODE: Set MIXAM_MOCK_MODE=true to use mock responses
 * This allows full testing without Mixam API approval
 */

const MIXAM_API_BASE_URL = process.env.MIXAM_API_BASE_URL || 'https://mixam.co.uk';
const MIXAM_MOCK_MODE = process.env.MIXAM_MOCK_MODE === 'true';

type MixamAuthToken = {
  token: string;
  expiresAt: number;
};

type MixamFileUploadResponse = {
  fileId: string;
  url: string;
  checksum: string;
};

type MixamOrderResponse = {
  orderId: string;
  jobNumber: string;
  status: string;
};

type MixamPriceQuote = {
  unitPrice: number;
  totalPrice: number;
  shippingCost: number;
  setupFee: number;
  currency: 'GBP';
};

// Catalogue types
export type MixamCatalogueProduct = {
  id: number;
  name: string;
  subProducts?: MixamCatalogueSubProduct[];
};

export type MixamCatalogueSubProduct = {
  id: number;
  name: string;
};

export type MixamCatalogueItem = {
  products: MixamCatalogueProduct[];
};

export type MixamProductMetadata = {
  productId: number;
  subProductId: number;
  formats?: MixamFormatOption[];
  substrates?: MixamSubstrateOption[];
  bindings?: MixamBindingOption[];
  laminations?: MixamLaminationOption[];
  // Raw response for debugging
  raw?: any;
};

export type MixamFormatOption = {
  id: number;
  name: string;
  longEdge?: number;
  shortEdge?: number;
};

export type MixamSubstrateOption = {
  typeId: number;
  typeName: string;
  weights?: { id: number; weight: number; unit: string }[];
  colours?: { id: number; name: string }[];
};

export type MixamBindingOption = {
  type: string;
  name: string;
};

export type MixamLaminationOption = {
  type: string;
  name: string;
};

class MixamAPIClient {
  private tokenCache: MixamAuthToken | null = null;

  /**
   * Authenticates with Mixam and returns JWT token
   * MOCK MODE: Returns fake token
   *
   * Authentication per Mixam docs:
   * https://mixam.co.uk/documentation/api/public#security
   * - POST /token with Basic Auth (username:password)
   * - Returns JWT token which must be used in Authorization header for all other endpoints
   * - Token has a lifespan and should be cached/reused until expiry
   */
  async authenticate(): Promise<string> {
    if (MIXAM_MOCK_MODE) {
      return this.mockAuthenticate();
    }

    // Check if we have a valid cached token (with 5 min buffer before expiry)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + (5 * 60 * 1000)) {
      console.log('[Mixam] Using cached JWT token');
      return this.tokenCache.token;
    }

    const username = process.env.MIXAM_USERNAME;
    const password = process.env.MIXAM_PASSWORD;

    if (!username || !password) {
      throw new Error('Mixam credentials not configured. Set MIXAM_USERNAME and MIXAM_PASSWORD in .env');
    }

    const tokenUrl = `${MIXAM_API_BASE_URL}/api/user/token`;
    console.log(`[Mixam] Requesting new JWT token from: ${tokenUrl}`);

    // Basic Auth credentials for token endpoint
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept': '*/*',
        },
      });
    } catch (fetchError: any) {
      console.error(`[Mixam] Network error calling ${tokenUrl}:`, fetchError);
      throw new Error(`Network error authenticating with Mixam (${tokenUrl}): ${fetchError.message || fetchError}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mixam] Auth error ${response.status}:`, errorText);
      throw new Error(`Mixam authentication failed (${response.status}): ${errorText}`);
    }

    // Mixam returns the JWT token directly as plain text, not wrapped in JSON
    const responseText = await response.text();
    let token: string;

    // Try parsing as JSON first (in case API changes), fall back to raw text
    try {
      const data = JSON.parse(responseText);
      token = data.token || responseText;
    } catch {
      // Response is the raw JWT token string
      token = responseText.trim();
    }

    if (!token || !token.startsWith('eyJ')) {
      throw new Error('Mixam authentication response does not contain a valid JWT token');
    }

    // JWT tokens contain expiration in the payload
    // Decode JWT to get actual expiration time
    let expiresIn = 23 * 60 * 60 * 1000; // Default 23 hours

    try {
      // JWT format: header.payload.signature (base64 encoded)
      const payloadBase64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

      if (payload.exp) {
        // exp is in seconds since epoch
        expiresIn = (payload.exp * 1000) - Date.now();
        console.log(`[Mixam] JWT token expires in ${Math.round(expiresIn / 1000 / 60)} minutes`);
      }
    } catch (e) {
      console.warn('[Mixam] Could not decode JWT expiration, using default 23 hours');
    }

    // Cache token for reuse
    this.tokenCache = {
      token,
      expiresAt: Date.now() + expiresIn,
    };

    console.log('[Mixam] JWT token obtained and cached');

    return token;
  }

  /**
   * Uploads a PDF file to Mixam
   * Returns file reference ID for use in MxJdf
   * MOCK MODE: Returns fake file ID
   */
  async uploadFile(params: {
    pdfBuffer: Buffer;
    filename: string;
  }): Promise<MixamFileUploadResponse> {
    if (MIXAM_MOCK_MODE) {
      return this.mockUploadFile(params);
    }

    const { pdfBuffer, filename } = params;
    const token = await this.authenticate();

    // Calculate MD5 checksum
    const crypto = require('crypto');
    const checksum = crypto.createHash('md5').update(pdfBuffer).digest('hex');

    const formData = new FormData();
    formData.append('file', new Blob([pdfBuffer]), filename);
    formData.append('checksum', checksum);

    const response = await fetch(`${MIXAM_API_BASE_URL}/api/public/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`File upload failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      fileId: data.fileId,
      url: data.url,
      checksum,
    };
  }

  /**
   * Submits an order to Mixam using MxJdf
   * Returns Mixam order ID and job number
   * MOCK MODE: Returns fake order ID
   */
  async submitOrder(mxjdf: MxJdfDocument): Promise<MixamOrderResponse> {
    if (MIXAM_MOCK_MODE) {
      return this.mockSubmitOrder(mxjdf);
    }

    const token = await this.authenticate();
    const url = `${MIXAM_API_BASE_URL}/api/public/orders`;

    console.log(`[Mixam] Submitting order to: ${url}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mxjdf),
      });
    } catch (fetchError: any) {
      console.error(`[Mixam] Network error calling ${url}:`, fetchError);
      throw new Error(`Network error calling Mixam API (${url}): ${fetchError.message || fetchError}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mixam] API error ${response.status}:`, errorText);
      throw new Error(`Order submission failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[Mixam] Order submission response: ${JSON.stringify(data).substring(0, 500)}`);

    // Mixam returns { order: { id, orderNumber, orderStatus, ... } }
    const orderData = data.order || data;

    return {
      orderId: orderData.id || orderData.orderId,
      jobNumber: String(orderData.orderNumber || orderData.jobNumber || ''),
      status: orderData.orderStatus || orderData.status || 'INIT',
    };
  }

  /**
   * Gets current status of an order
   * MOCK MODE: Returns fake status
   *
   * Note: Mixam API doesn't support fetching a single order by ID.
   * We fetch the list of orders and find the matching one by ID or job number.
   */
  async getOrderStatus(orderId: string): Promise<{ status: string; trackingUrl?: string; estimatedDelivery?: string }> {
    if (MIXAM_MOCK_MODE) {
      return this.mockGetOrderStatus(orderId);
    }

    const token = await this.authenticate();

    // First, try to fetch the specific order directly by ID
    // Mixam API: GET /api/public/orders/{orderId}
    console.log(`[Mixam] Fetching order status for: ${orderId}`);

    const singleOrderUrl = `${MIXAM_API_BASE_URL}/api/public/orders/${orderId}`;
    console.log(`[Mixam] Trying single order endpoint: ${singleOrderUrl}`);

    const singleResponse = await fetch(singleOrderUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (singleResponse.ok) {
      const data = await singleResponse.json();
      console.log(`[Mixam] Single order response: ${JSON.stringify(data).substring(0, 500)}`);

      // Response could be { order: {...} } or just the order object
      const order = data.order || data;

      return {
        status: order.orderStatus || order.status || 'UNKNOWN',
        trackingUrl: order.trackingUrl,
        estimatedDelivery: order.estimatedDelivery,
      };
    }

    console.log(`[Mixam] Single order endpoint returned ${singleResponse.status}, trying orders list...`);

    // Fallback: Fetch list of orders and find the matching one
    const response = await fetch(`${MIXAM_API_BASE_URL}/api/public/user/orders`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mixam] Failed to get orders list: ${response.status}`, errorText);
      throw new Error(`Failed to get orders: ${response.status}`);
    }

    const data = await response.json();

    // Log response structure for debugging (single line)
    console.log(`[Mixam] Orders API response type: ${typeof data}, isArray: ${Array.isArray(data)}, keys: ${data && typeof data === 'object' ? Object.keys(data).join(',') : 'N/A'}`);
    console.log(`[Mixam] Orders API response: ${JSON.stringify(data).substring(0, 500)}`);

    // The response should be an array of orders or { orders: [...] } or other structure
    let orders: any[] = [];
    if (Array.isArray(data)) {
      orders = data;
    } else if (data?.orders && Array.isArray(data.orders)) {
      orders = data.orders;
    } else if (data?.content && Array.isArray(data.content)) {
      // Some APIs use { content: [...] } for paginated results
      orders = data.content;
    } else if (typeof data === 'object' && data !== null) {
      // Maybe the response is a single order or wrapped differently
      console.log(`[Mixam] Unexpected response structure, attempting to find orders...`);
      // Try to find any array in the response
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          console.log(`[Mixam] Found array at key '${key}' with ${data[key].length} items`);
          orders = data[key];
          break;
        }
      }
    }

    console.log(`[Mixam] Parsed ${orders.length} orders from response`);

    // Find the order by ID or orderNumber (job number)
    const order = orders.find((o: any) =>
      o.id === orderId ||
      String(o.orderNumber) === orderId ||
      o.orderNumber === parseInt(orderId, 10)
    );

    if (!order) {
      console.error(`[Mixam] Order not found in list. Looking for: ${orderId}`);
      const orderSummaries = orders.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.orderStatus || o.status
      }));
      console.log(`[Mixam] All orders in response: ${JSON.stringify(orderSummaries)}`);

      // Include order summaries in error for debugging
      const orderList = orderSummaries.length > 0
        ? `\nAvailable orders: ${orderSummaries.map((o: any) => `${o.orderNumber || o.id}`).join(', ')}`
        : '\nNo orders found in Mixam account.';
      const hint = '\n(Note: Newly submitted orders may take a few minutes to appear in the Mixam orders list.)';
      throw new Error(`Order ${orderId} not found in Mixam orders list.${orderList}${hint}`);
    }

    console.log(`[Mixam] Found order: id=${order.id}, orderNumber=${order.orderNumber}, status=${order.orderStatus}`);

    return {
      status: order.orderStatus || order.status || 'UNKNOWN',
      trackingUrl: order.trackingUrl,
      estimatedDelivery: order.estimatedDelivery,
    };
  }

  /**
   * Cancels an order with Mixam
   * MOCK MODE: Returns success immediately
   *
   * Note: Orders can only be cancelled if they are not already in production.
   * Uses PUT /api/public/orders/{orderId}/status with body "CANCELED"
   */
  async cancelOrder(orderId: string): Promise<MixamOrderResponse> {
    if (MIXAM_MOCK_MODE) {
      return this.mockCancelOrder(orderId);
    }

    const token = await this.authenticate();
    const url = `${MIXAM_API_BASE_URL}/api/public/orders/${orderId}/status`;

    console.log(`[Mixam] Cancelling order ${orderId} via: ${url}`);

    // Try different body formats - Mixam API docs aren't clear on exact format
    // Trying plain text first since JSON.stringify('CANCELED') produces '"CANCELED"'
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body: 'CANCELED',
      });
    } catch (fetchError: any) {
      console.error(`[Mixam] Network error calling ${url}:`, fetchError);
      throw new Error(`Network error calling Mixam API (${url}): ${fetchError.message || fetchError}`);
    }

    if (!response.ok) {
      // Get raw response text first for debugging
      const rawText = await response.text();
      console.error(`[Mixam] Cancel order error ${response.status}, raw response:`, rawText);

      // Try to parse as JSON
      let errorData: any = { error: 'Unknown error' };
      try {
        errorData = JSON.parse(rawText);
      } catch {
        // Response wasn't JSON, use raw text as error message
        errorData = { error: rawText || 'Unknown error' };
      }

      // Extract error message from various possible formats
      const errorMessage = errorData.message || errorData.error || errorData.reason || rawText || 'Unknown error';

      if (response.status === 409) {
        // 409 Conflict - could be various reasons (in production, already cancelled, etc.)
        throw new Error(`Order cannot be cancelled: ${errorMessage}`);
      }
      if (response.status === 404) {
        throw new Error(`Order not found: ${orderId}`);
      }
      if (response.status === 400) {
        throw new Error(`Invalid cancel request: ${errorMessage}`);
      }

      throw new Error(`Failed to cancel order (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    console.log(`[Mixam] Cancel order response: ${JSON.stringify(data).substring(0, 300)}`);

    return {
      orderId: data.orderId || orderId,
      jobNumber: data.orderNumber ? String(data.orderNumber) : '',
      status: data.status || 'CANCELED',
    };
  }

  /**
   * Gets a price quote for a given specification
   * MOCK MODE: Returns estimate based on quantity
   */
  async getPriceQuote(params: {
    productType: string;
    quantity: number;
    pageCount: number;
  }): Promise<MixamPriceQuote> {
    if (MIXAM_MOCK_MODE) {
      return this.mockGetPriceQuote(params);
    }

    const token = await this.authenticate();

    // This would need the actual Mixam price quote endpoint
    // Structure TBD based on actual API
    const response = await fetch(`${MIXAM_API_BASE_URL}/api/public/quote`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to get price quote: ${response.status}`);
    }

    const data = await response.json();

    return {
      unitPrice: data.unitPrice,
      totalPrice: data.totalPrice,
      shippingCost: data.shippingCost,
      setupFee: data.setupFee || 0,
      currency: 'GBP',
    };
  }

  // ==================== CATALOGUE FUNCTIONS ====================

  /**
   * Gets the full Mixam product catalogue
   * https://mixam.co.uk/documentation/api/public#catalogue
   */
  async getCatalogue(): Promise<MixamCatalogueItem> {
    if (MIXAM_MOCK_MODE) {
      return this.mockGetCatalogue();
    }

    const token = await this.authenticate();
    const url = `${MIXAM_API_BASE_URL}/api/public/catalogue`;

    console.log(`[Mixam] Fetching catalogue from: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mixam] Catalogue error ${response.status}:`, errorText);
      throw new Error(`Failed to get catalogue: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[Mixam] Catalogue response received');

    return data;
  }

  /**
   * Gets metadata for a specific product/subProduct combination
   * This includes available formats, substrates, bindings, etc.
   * https://mixam.co.uk/documentation/api/public#catalogue
   */
  async getProductMetadata(productId: number, subProductId: number): Promise<MixamProductMetadata> {
    if (MIXAM_MOCK_MODE) {
      return this.mockGetProductMetadata(productId, subProductId);
    }

    const token = await this.authenticate();
    const url = `${MIXAM_API_BASE_URL}/api/public/products/metadata/${productId}/${subProductId}`;

    console.log(`[Mixam] Fetching product metadata from: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mixam] Product metadata error ${response.status}:`, errorText);
      throw new Error(`Failed to get product metadata: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[Mixam] Product metadata response received');

    // Parse the response to extract relevant fields
    return {
      productId,
      subProductId,
      formats: data.formats || data.sizes || [],
      substrates: data.substrates || data.papers || [],
      bindings: data.bindings || [],
      laminations: data.laminations || data.finishes || [],
      raw: data,
    };
  }

  /**
   * Gets item specification options for a product
   * https://mixam.co.uk/documentation/api/public#itemspecification
   */
  async getItemSpecification(productId: number, subProductId: number): Promise<any> {
    if (MIXAM_MOCK_MODE) {
      return this.mockGetItemSpecification(productId, subProductId);
    }

    const token = await this.authenticate();
    const url = `${MIXAM_API_BASE_URL}/api/public/products/spec/${productId}/${subProductId}`;

    console.log(`[Mixam] Fetching item specification from: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mixam] Item spec error ${response.status}:`, errorText);
      throw new Error(`Failed to get item specification: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[Mixam] Item specification response received');

    return data;
  }

  // ==================== MOCK MODE FUNCTIONS ====================

  private mockAuthenticate(): string {
    console.log('[MIXAM MOCK] Authenticating...');
    return 'mock_jwt_token_' + Date.now();
  }

  private mockUploadFile(params: { pdfBuffer: Buffer; filename: string }): MixamFileUploadResponse {
    console.log(`[MIXAM MOCK] Uploading file: ${params.filename}`);
    const mockFileId = 'mock_file_' + Math.random().toString(36).substring(7);
    return {
      fileId: mockFileId,
      url: `https://mock-mixam-files.com/${mockFileId}`,
      checksum: 'mock_checksum_' + params.filename,
    };
  }

  private mockSubmitOrder(mxjdf: MxJdfDocument): MixamOrderResponse {
    const externalOrderId = mxjdf.metadata?.externalOrderId || 'unknown';
    console.log(`[MIXAM MOCK] Submitting order for: ${externalOrderId}`);
    const mockOrderId = 'MOCK-' + Date.now();
    const mockJobNumber = 'MXM' + Math.floor(100000 + Math.random() * 900000);

    // Simulate webhook delivery after delay (in real implementation, would be separate process)
    if (process.env.NODE_ENV !== 'production') {
      setTimeout(() => {
        console.log(`[MIXAM MOCK] Would send webhook for order ${externalOrderId}`);
      }, 2000);
    }

    return {
      orderId: mockOrderId,
      jobNumber: mockJobNumber,
      status: 'submitted',
    };
  }

  private mockCancelOrder(orderId: string): MixamOrderResponse {
    console.log(`[MIXAM MOCK] Cancelling order: ${orderId}`);
    return {
      orderId,
      jobNumber: '',
      status: 'CANCELED',
    };
  }

  private mockGetOrderStatus(orderId: string): { status: string; trackingUrl?: string; estimatedDelivery?: string } {
    console.log(`[MIXAM MOCK] Getting status for order: ${orderId}`);

    // Simulate different statuses based on order ID
    const statuses = ['submitted', 'confirmed', 'in_production', 'shipped', 'delivered'];
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

    return {
      status: randomStatus,
      trackingUrl: randomStatus === 'shipped' || randomStatus === 'delivered'
        ? `https://track.royalmail.com/mock/${orderId}`
        : undefined,
      estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  private mockGetPriceQuote(params: { productType: string; quantity: number; pageCount: number }): MixamPriceQuote {
    console.log(`[MIXAM MOCK] Getting price quote for ${params.quantity} books with ${params.pageCount} pages`);

    // Simple mock pricing based on quantity
    let unitPrice = 15.00;
    if (params.quantity >= 11 && params.quantity <= 50) {
      unitPrice = 12.50;
    } else if (params.quantity > 50) {
      unitPrice = 10.00;
    }

    const totalPrice = unitPrice * params.quantity;
    const shippingCost = 5.00 + (params.quantity * 0.50);

    return {
      unitPrice,
      totalPrice,
      shippingCost,
      setupFee: 0,
      currency: 'GBP',
    };
  }

  private mockGetCatalogue(): MixamCatalogueItem {
    console.log('[MIXAM MOCK] Getting catalogue');
    return {
      products: [
        { id: 1, name: 'Brochures', subProducts: [{ id: 0, name: 'Standard' }] },
        { id: 2, name: 'Books', subProducts: [{ id: 0, name: 'Paperback' }, { id: 1, name: 'Hardcover' }] },
        { id: 3, name: 'Posters', subProducts: [{ id: 0, name: 'Standard' }] },
      ],
    };
  }

  private mockGetProductMetadata(productId: number, subProductId: number): MixamProductMetadata {
    console.log(`[MIXAM MOCK] Getting product metadata for ${productId}/${subProductId}`);
    // Mock data based on actual Mixam catalogue for hardcover books
    // Note: Weight IDs must match what Mixam actually offers
    // - For silk interior: 0 (90gsm), 2 (115gsm), 3 (130gsm), 4 (150gsm), 5 (170gsm)
    // - For silk cover: 5 (170gsm) is the standard for hardcover
    // - Weight ID 14 (200gsm) is NOT available for silk/book products
    return {
      productId,
      subProductId,
      formats: [
        { id: 4, name: 'A4', longEdge: 297, shortEdge: 210 },
        { id: 5, name: 'A5', longEdge: 210, shortEdge: 148 },
        { id: 6, name: 'A6', longEdge: 148, shortEdge: 105 },
      ],
      substrates: [
        {
          typeId: 1,
          typeName: 'Silk',
          weights: [
            { id: 0, weight: 90, unit: 'GSM' },
            { id: 2, weight: 115, unit: 'GSM' },
            { id: 3, weight: 130, unit: 'GSM' },
            { id: 4, weight: 150, unit: 'GSM' },
            { id: 5, weight: 170, unit: 'GSM' },
          ],
        },
        {
          typeId: 2,
          typeName: 'Gloss',
          weights: [
            { id: 0, weight: 90, unit: 'GSM' },
            { id: 2, weight: 115, unit: 'GSM' },
            { id: 3, weight: 130, unit: 'GSM' },
            { id: 4, weight: 150, unit: 'GSM' },
            { id: 5, weight: 170, unit: 'GSM' },
          ],
        },
        {
          typeId: 3,
          typeName: 'Uncoated',
          weights: [
            { id: 0, weight: 90, unit: 'GSM' },
            { id: 2, weight: 115, unit: 'GSM' },
            { id: 3, weight: 130, unit: 'GSM' },
          ],
        },
      ],
      bindings: [
        { type: 'PUR', name: 'PUR Binding' },
        { type: 'CASE', name: 'Case Binding' },
      ],
      laminations: [
        { type: 'NONE', name: 'No Lamination' },
        { type: 'GLOSS', name: 'Gloss Lamination' },
        { type: 'MATT', name: 'Matt Lamination' },
        { type: 'SOFT_TOUCH', name: 'Soft Touch Lamination' },
      ],
      raw: { mock: true },
    };
  }

  private mockGetItemSpecification(productId: number, subProductId: number): any {
    console.log(`[MIXAM MOCK] Getting item specification for ${productId}/${subProductId}`);
    return {
      productId,
      subProductId,
      mock: true,
      specification: {
        minPages: 8,
        maxPages: 400,
        pageIncrement: 4,
      },
    };
  }
}

// Export singleton instance
export const mixamClient = new MixamAPIClient();

// Export helper functions

/**
 * Downloads a PDF from a URL and returns as Buffer
 */
export async function downloadPDF(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Calculates MD5 checksum of a buffer
 */
export function calculateChecksum(buffer: Buffer): string {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(buffer).digest('hex');
}
