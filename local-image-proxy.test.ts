import { describe, expect, it } from "vitest";
import { isBlockedAddress, sniffRasterImageType } from "./local-image-proxy";

describe("local image proxy safety helpers", () => {
  it("blocks local and private address ranges", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.20")).toBe(true);
    expect(isBlockedAddress("10.0.0.8")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });

  it("accepts only recognized raster image signatures", () => {
    expect(sniffRasterImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(
      "image/png",
    );
    expect(sniffRasterImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffRasterImageType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });
});
