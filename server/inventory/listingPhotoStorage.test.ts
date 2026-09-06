import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getDb } from "./db";
import { listingPhotoUrl, rotateListingPhoto } from "./listingPhotoStorage";

vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));

const storedPhoto = {
  id: 17,
  photoKey: "defective/ABC123/01.jpg",
  contentType: "image/jpeg",
  dataBase64: Buffer.from("original").toString("base64"),
};

function dbWithPhoto(row = storedPhoto) {
  const limit = vi.fn().mockResolvedValue([row]);
  const selectWhere = vi.fn().mockReturnValue({ limit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return { db: { select, update }, update, updateSet, updateWhere };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("listing photo storage", () => {
  it.each([undefined, "not a URL"])(
    "does not access the database when the public URL is unavailable or invalid",
    async publicSiteUrl => {
      vi.stubEnv("APP_ENV", "test");
      vi.stubEnv("PUBLIC_SITE_URL", publicSiteUrl ?? "");

      await expect(
        rotateListingPhoto(storedPhoto.photoKey, 90)
      ).rejects.toThrow("PUBLIC_SITE_URL");

      expect(getDb).not.toHaveBeenCalled();
    }
  );

  it("rotates the stored photo and returns a public cache-busted URL", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("PUBLIC_SITE_URL", "https://photos.example.invalid?");
    const { db, update, updateSet, updateWhere } = dbWithPhoto();
    vi.mocked(getDb).mockResolvedValue(db as never);
    const toBuffer = vi.fn().mockResolvedValue(Buffer.from("rotated"));
    const jpeg = vi.fn().mockReturnValue({ toBuffer });
    const rotate = vi.fn().mockReturnValue({ jpeg });
    vi.mocked(sharp).mockReturnValue({ rotate } as never);
    vi.spyOn(Date, "now").mockReturnValue(1234567890);

    await expect(rotateListingPhoto(storedPhoto.photoKey, 90)).resolves.toEqual(
      {
        key: storedPhoto.photoKey,
        bytes: 7,
        url: "https://photos.example.invalid/api/listing-photos/defective/ABC123/01.jpg?v=17-1234567890",
      }
    );

    expect(rotate).toHaveBeenCalledWith(90);
    expect(update).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      contentType: "image/jpeg",
      dataBase64: Buffer.from("rotated").toString("base64"),
    });
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it("builds a photo endpoint path from an origin without URL delimiters", () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("PUBLIC_SITE_URL", "https://photos.example.invalid#");

    expect(listingPhotoUrl("defective/ABC 123/01#.jpg")).toBe(
      "https://photos.example.invalid/api/listing-photos/defective/ABC%20123/01%23.jpg"
    );
  });
});
