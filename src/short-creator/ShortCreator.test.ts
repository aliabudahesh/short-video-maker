process.env.LOG_LEVEL = "debug";

import { test, expect, vi } from "vitest";
import fs from "fs-extra";

import { ShortCreator } from "./ShortCreator";
import { Kokoro } from "./libraries/Kokoro";
import { Remotion } from "./libraries/Remotion";
import { Whisper } from "./libraries/Whisper";
import { FFMpeg } from "./libraries/FFmpeg";
import { GifAPI } from "./libraries/GifAPI";
import { Config } from "../config";
import { MusicManager } from "./music";
import https from "https";

// mock fs-extra with an in-memory map
vi.mock("fs-extra", () => {
  const files = new Map<string, string>([
    [
      "/Users/gyoridavid/.ai-agents-az-video-generator/videos/video-1.mp4",
      "mock video content 1",
    ],
    [
      "/Users/gyoridavid/.ai-agents-az-video-generator/videos/video-2.mp4",
      "mock video content 2",
    ],
    ["/Users/gyoridavid/.ai-agents-az-video-generator/videos", "__dir__"],
    ["/Users/gyoridavid/.ai-agents-az-video-generator/temp", "__dir__"],
    ["/Users/gyoridavid/.ai-agents-az-video-generator/libs", "__dir__"],
    ["/static/music/happy-music.mp3", "mock music content"],
    ["/static/music/sad-music.mp3", "mock music content"],
    ["/static/music/chill-music.mp3", "mock music content"],
  ]);

  const fsExtra = {
    ensureDirSync: vi.fn((p: string) => {
      files.set(p, "__dir__");
    }),
    removeSync: vi.fn((p: string) => {
      files.delete(p);
    }),
    createWriteStream: vi.fn(() => {
      let finishCb: (() => void) | null = null;
      const stream = {
        on: vi.fn((event: string, cb: () => void) => {
          if (event === "finish") {
            finishCb = cb;
          }
          return stream;
        }),
        write: vi.fn(),
        end: vi.fn(() => {
          finishCb?.();
        }),
        close: vi.fn(),
      } as any;
      return stream;
    }),
    readFileSync: vi.fn((p: string) =>
      Buffer.from(files.get(p) ?? "", "utf-8"),
    ),
    writeFileSync: vi.fn((p: string, data: string) => {
      files.set(p, data);
    }),
    existsSync: vi.fn((p: string) => files.has(p)),
    readdirSync: vi.fn((dir: string) => {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      return Array.from(files.keys())
        .filter((p) => p.startsWith(prefix) && p !== dir)
        .map((p) => p.slice(prefix.length));
    }),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    renameSync: vi.fn((oldPath: string, newPath: string) => {
      const content = files.get(oldPath);
      if (content !== undefined) {
        files.set(newPath, content);
        files.delete(oldPath);
      }
    }),
    unlink: vi.fn((p: string, cb: () => void) => {
      files.delete(p);
      cb();
    }),
    default: undefined as unknown as any,
  } as any;

  fsExtra.default = fsExtra;
  return fsExtra;
});

// mock https.get to avoid real network calls
vi.spyOn(https, "get").mockImplementation((url: string, cb: any) => {
  const { PassThrough } = require("stream");
  const res = new PassThrough();
  (res as any).statusCode = 200;
  res.pipe = (dest: any) => {
    dest.end();
    return dest;
  };
  process.nextTick(() => {
    cb(res);
  });
  return { on: vi.fn() } as any;
});

// Mock fluent-ffmpeg
vi.mock("fluent-ffmpeg", () => {
  const mockOn = vi.fn().mockReturnThis();
  const mockSave = vi.fn().mockReturnThis();
  const mockPipe = vi.fn().mockReturnThis();

  const ffmpegMock: any = vi.fn(() => ({
    input: vi.fn().mockReturnThis(),
    audioCodec: vi.fn().mockReturnThis(),
    audioBitrate: vi.fn().mockReturnThis(),
    audioChannels: vi.fn().mockReturnThis(),
    audioFrequency: vi.fn().mockReturnThis(),
    toFormat: vi.fn().mockReturnThis(),
    on: mockOn,
    save: mockSave,
    pipe: mockPipe,
  }));

  (ffmpegMock as any).setFfmpegPath = vi.fn();

  return { default: ffmpegMock };
});

// mock kokoro-js
vi.mock("kokoro-js", () => {
  return {
    TextSplitterStream: class {
      push() {}
      close() {}
    },
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue({
        stream: vi.fn().mockReturnValue(
          (async function* () {
            yield {
              audio: {
                toWav: () => new ArrayBuffer(100),
                audio: { audio: new ArrayBuffer(100), sampling_rate: 44100 },
                sampling_rate: 44100,
              },
            };
          })(),
        ),
      }),
    },
  };
});

// mock remotion
vi.mock("@remotion/bundler", () => {
  return {
    bundle: vi.fn().mockResolvedValue("mocked-bundled-url"),
  };
});
vi.mock("@remotion/renderer", () => {
  return {
    renderMedia: vi.fn().mockResolvedValue(undefined),
    selectComposition: vi.fn().mockResolvedValue({
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 300,
    }),
    ensureBrowser: vi.fn().mockResolvedValue(undefined),
  };
});

// mock whisper
vi.mock("@remotion/install-whisper-cpp", () => {
  return {
    downloadWhisperModel: vi.fn().mockResolvedValue(undefined),
    installWhisperCpp: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({
      transcription: [
        {
          text: "This is a mock transcription.",
          offsets: { from: 0, to: 2000 },
          tokens: [
            { text: "This", timestamp: { from: 0, to: 500 } },
            { text: " is", timestamp: { from: 500, to: 800 } },
            { text: " a", timestamp: { from: 800, to: 1000 } },
            { text: " mock", timestamp: { from: 1000, to: 1500 } },
            { text: " transcription.", timestamp: { from: 1500, to: 2000 } },
          ],
        },
      ],
    }),
  };
});

test.skip("test me", async () => {
  const kokoro = await Kokoro.init("fp16");
  const ffmpeg = await FFMpeg.init();

  vi.spyOn(ffmpeg, "saveNormalizedAudio").mockResolvedValue("mocked-path.wav");
  vi.spyOn(ffmpeg, "saveToMp3").mockResolvedValue("mocked-path.mp3");

  const gifApi = new GifAPI("tenor", "giphy");
  vi.spyOn(gifApi, "findVideos").mockResolvedValue([
    {
      id: "mock-video-id-1",
      url: "https://example.com/mock-video-1.mp4",
      width: 1080,
      height: 1920,
    },
  ]);

  const config = new Config();
  const remotion = await Remotion.init(config);

  // control the render promise resolution
  let resolveRenderPromise!: () => void;
  const renderPromiseMock: Promise<void> = new Promise((resolve) => {
    resolveRenderPromise = resolve;
  });
  vi.spyOn(remotion, "render").mockReturnValue(renderPromiseMock);

  const whisper = await Whisper.init(config);

  vi.spyOn(whisper, "CreateCaption").mockResolvedValue([
    { text: "This", startMs: 0, endMs: 500 },
    { text: " is", startMs: 500, endMs: 800 },
    { text: " a", startMs: 800, endMs: 1000 },
    { text: " mock", startMs: 1000, endMs: 1500 },
    { text: " transcription.", startMs: 1500, endMs: 2000 },
  ]);

  const musicManager = new MusicManager(config);

  const shortCreator = new ShortCreator(
    config,
    remotion,
    kokoro,
    whisper,
    ffmpeg,
    gifApi,
    musicManager,
  );

  const videoId = shortCreator.addToQueue(
    [
      {
        text: "test",
        searchTerms: ["test"],
      },
    ],
    {},
  );

  // list videos while the video is being processed
  let videos = shortCreator.listAllVideos();
  expect(videos.find((v) => v.id === videoId)?.status).toBe("processing");

  // create the video file on the file system and check the status again
  fs.writeFileSync(shortCreator.getVideoPath(videoId), "mock video content");
  videos = shortCreator.listAllVideos();
  expect(videos.find((v) => v.id === videoId)?.status).toBe("processing");

  // resolve the render promise to simulate the video being processed, and wait for queue to drain
  resolveRenderPromise();
  // wait until processing queue is empty
  while ((shortCreator as any).queue.length) {
    await new Promise((r) => setTimeout(r, 10));
  }
  videos = shortCreator.listAllVideos();
  expect(videos.find((v) => v.id === videoId)?.status).toBe("ready");

  // check the status of the video directly
  const status = shortCreator.status(videoId);
  expect(status).toBe("ready");
});
