import { apiRequest } from "../api/client";
import type {
  CreatePackSizeRequest,
  DeletePackSizeRequest,
  PackSizeStatusRequest,
  ProductPackSize,
  ProductPackSizesResponse,
} from "./packSizes.types";

const base = (productId: string) => `/products/${encodeURIComponent(productId)}/pack-sizes`;

export async function getProductPackSizes(accessToken: string, productId: string): Promise<ProductPackSize[]> {
  const response = await apiRequest<ProductPackSizesResponse>(base(productId), {}, accessToken);
  return response.pack_sizes ?? [];
}

export async function createProductPackSize(accessToken: string, productId: string, payload: CreatePackSizeRequest): Promise<ProductPackSize> {
  const response = await apiRequest<{ pack_size: ProductPackSize }>(base(productId), {
    method: "POST",
    body: JSON.stringify(payload),
  }, accessToken);
  return response.pack_size;
}

export async function updateProductPackSizeStatus(accessToken: string, productId: string, packSizeId: string, payload: PackSizeStatusRequest): Promise<ProductPackSize> {
  const response = await apiRequest<{ pack_size: ProductPackSize }>(`${base(productId)}/${encodeURIComponent(packSizeId)}/status`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, accessToken);
  return response.pack_size;
}

export function deleteProductPackSize(accessToken: string, productId: string, packSizeId: string, payload: DeletePackSizeRequest) {
  return apiRequest<{ success?: boolean }>(`${base(productId)}/${encodeURIComponent(packSizeId)}`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  }, accessToken);
}
