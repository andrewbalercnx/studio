"use strict";
/**
 * @storypic/api-client
 *
 * Typed API client for StoryPic Kids child-facing features.
 * Used by PWA and mobile clients.
 *
 * NOTE: This client only exposes child-safe operations.
 * Parent management, print ordering, and admin functions are excluded.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoryPicClient = void 0;
var client_js_1 = require("./client.js");
Object.defineProperty(exports, "StoryPicClient", { enumerable: true, get: function () { return client_js_1.StoryPicClient; } });
// Re-export all types from shared-types for convenience
__exportStar(require("@storypic/shared-types"), exports);
//# sourceMappingURL=index.js.map