// Faces in video frames, off the server's main thread: where each face is, its expression (seven
// classes) and how open its mouth is, by face-api (@vladmandic/face-api: a tiny face detector,
// 68 landmarks, an expression net) on TensorFlow.js's CPU backend. ~0.8 s a frame at 224 px.
//
// The library's single-file bundle is built for browsers; under Node it takes a code path that wants
// `util`, so the worker presents itself as a browser before loading it (only this thread sees that).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort } from "node:worker_threads";

export type FaceResult = {
  box: [number, number, number, number];
  score: number;
  expressions: Record<string, number>;
  /** Inner-lip gap over face height: ~0 closed, ~0.1+ open. */
  mouth: number;
};
export type FrameJob = { id: number; width: number; height: number; frames: Uint8Array[] };
export type FrameReply = { id: number; faces: FaceResult[][]; ms: number } | { id: number; error: string };

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.document = {};

type Point = { x: number; y: number };
type Detection = {
  detection: { box: { x: number; y: number; width: number; height: number }; score: number };
  landmarks: { positions: Point[] };
  expressions: Record<string, number>;
};
type FaceApi = {
  tf: {
    setBackend(name: string): Promise<boolean>;
    ready(): Promise<void>;
    tensor3d(values: Uint8Array, shape: [number, number, number], dtype: string): { dispose(): void };
    io: { decodeWeights(buf: ArrayBuffer, specs: unknown): unknown };
  };
  nets: Record<string, { loadFromWeightMap(map: unknown): void }>;
  TinyFaceDetectorOptions: new (o: { inputSize: number; scoreThreshold: number }) => unknown;
  detectAllFaces(input: unknown, options: unknown): { withFaceLandmarks(tiny: boolean): { withFaceExpressions(): Promise<Detection[]> } };
};

let api: Promise<FaceApi> | null = null;

function load(): Promise<FaceApi> {
  api ??= (async () => {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("@vladmandic/face-api/package.json"));
    const faceapi = (await import(pathToFileURL(join(root, "dist", "face-api.esm.js")).href)) as FaceApi;
    await faceapi.tf.setBackend("cpu");
    await faceapi.tf.ready();
    const net = (name: string, file: string) => {
      const manifest = JSON.parse(readFileSync(join(root, "model", `${file}-weights_manifest.json`), "utf8")) as Array<{ weights: unknown }>;
      const bin = readFileSync(join(root, "model", `${file}.bin`));
      faceapi.nets[name].loadFromWeightMap(faceapi.tf.io.decodeWeights(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length) as ArrayBuffer, manifest[0].weights));
    };
    net("tinyFaceDetector", "tiny_face_detector_model");
    net("faceLandmark68TinyNet", "face_landmark_68_tiny_model");
    net("faceExpressionNet", "face_expression_model");
    return faceapi;
  })();
  return api;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

async function analyze(job: FrameJob): Promise<FaceResult[][]> {
  const faceapi = await load();
  const out: FaceResult[][] = [];
  for (const frame of job.frames) {
    const img = faceapi.tf.tensor3d(frame, [job.height, job.width, 3], "int32");
    try {
      const found = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 })).withFaceLandmarks(true).withFaceExpressions();
      out.push(
        found.map((f) => {
          const p = f.landmarks.positions;
          const b = f.detection.box;
          // The 68-point layout: inner lips 60–67 (62 top middle, 66 bottom middle).
          const gap = p.length >= 68 ? (dist(p[62], p[66]) + dist(p[61], p[67]) + dist(p[63], p[65])) / 3 : 0;
          return {
            box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
            score: Math.round(f.detection.score * 1000) / 1000,
            expressions: Object.fromEntries(Object.entries(f.expressions).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
            mouth: Math.round((gap / Math.max(1, b.height)) * 1000) / 1000,
          };
        }),
      );
    } finally {
      img.dispose();
    }
  }
  return out;
}

parentPort?.on("message", (job: FrameJob) => {
  const t = Date.now();
  analyze(job).then(
    (faces) => parentPort!.postMessage({ id: job.id, faces, ms: Date.now() - t } satisfies FrameReply),
    (err: unknown) => parentPort!.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) } satisfies FrameReply),
  );
});
