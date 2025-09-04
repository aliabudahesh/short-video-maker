import { getOrientationConfig } from "../../components/utils";
import { logger } from "../../logger";
import { OrientationEnum, type Video } from "../../types/shorts";

export class GifAPI {
  constructor(
    private tenorApiKey: string,
    private giphyApiKey: string,
  ) {}

  private async searchTenor(query: string) {
    if (!this.tenorApiKey) {
      throw new Error("Tenor API key not set");
    }
    const res = await fetch(
      `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
        query,
      )}&key=${this.tenorApiKey}&limit=50&media_filter=mp4`,
    );
    if (!res.ok) {
      throw new Error(`Tenor API error: ${res.status}`);
    }
    const json = await res.json();
    const results = json.results as {
      id: string;
      duration: number;
      media_formats: { mp4: { url: string; dims: [number, number] } };
    }[];
    return results.map((r) => ({
      id: r.id,
      url: r.media_formats.mp4.url,
      width: r.media_formats.mp4.dims[0],
      height: r.media_formats.mp4.dims[1],
      duration: r.duration || 0,
    }));
  }

  private async searchGiphy(query: string) {
    if (!this.giphyApiKey) {
      throw new Error("Giphy API key not set");
    }
    const res = await fetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${this.giphyApiKey}&q=${encodeURIComponent(
        query,
      )}&limit=50`,
    );
    if (!res.ok) {
      throw new Error(`Giphy API error: ${res.status}`);
    }
    const json = await res.json();
    const results = json.data as {
      id: string;
      images: {
        original: {
          mp4: string;
          mp4_size: string;
          width: string;
          height: string;
          frames?: string;
          duration?: string;
        };
      };
    }[];
    return results.map((r) => {
      const img = r.images.original;
      const duration =
        (img.duration ? parseFloat(img.duration) : undefined) ??
        (img.frames ? parseInt(img.frames, 10) / 30 : 0);
      return {
        id: r.id,
        url: img.mp4,
        width: parseInt(img.width, 10),
        height: parseInt(img.height, 10),
        duration,
      };
    });
  }

  async findVideos(
    searchTerms: string[],
    minDurationSeconds: number,
    excludeIds: string[] = [],
    orientation: OrientationEnum = OrientationEnum.portrait,
  ): Promise<Video[]> {
    const query = searchTerms.join(" ");
    logger.debug({ query }, "Searching Tenor and Giphy");
    const [tenor, giphy] = await Promise.all([
      this.searchTenor(query).catch((e) => {
        logger.error(e, "Tenor search failed");
        return [];
      }),
      this.searchGiphy(query).catch((e) => {
        logger.error(e, "Giphy search failed");
        return [];
      }),
    ]);
    const all = [...tenor, ...giphy].filter(
      (v) => !excludeIds.includes(v.id) && v.duration && v.url,
    );

        getOrientationConfig(orientation);
    const filtered = all.filter((v) => {
      return orientation === OrientationEnum.portrait
        ? v.height >= v.width
        : v.width >= v.height;
    });

    const selected: Video[] = [];
    let total = 0;
    for (const v of filtered) {
      selected.push({ id: v.id, url: v.url, width: v.width, height: v.height });
      total += v.duration;
      if (total >= minDurationSeconds) {
        break;
      }
    }
    if (!selected.length) {
      throw new Error("No videos found from Tenor or Giphy");
    }
    logger.debug({ query, count: selected.length }, "Videos selected");
    return selected;
  }
}

