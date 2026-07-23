import { createCanvas } from "@napi-rs/canvas";
import { randomInt, randomUUID, createHash } from "node:crypto";
import { redis } from "../redis.js";

const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — avoids ambiguous glyphs
const CODE_LENGTH = 6;
const CHALLENGE_TTL_SECONDS = 120;
const WIDTH = 220;
const HEIGHT = 90;

function normalizeAnswer(answer: string): string {
  return answer.trim().toUpperCase();
}

function hashAnswer(answer: string): string {
  return createHash("sha256").update(normalizeAnswer(answer)).digest("hex");
}

function randomText(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  return out;
}

function randomColor(minRgb: number, maxRgb: number, alpha = 1): string {
  const r = randomInt(minRgb, maxRgb);
  const g = randomInt(minRgb, maxRgb);
  const b = randomInt(minRgb, maxRgb);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderCaptchaPng(text: string): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0e0f13";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Noise lines behind the text
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = randomColor(60, 140, 0.6);
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(randomInt(WIDTH), randomInt(HEIGHT));
    ctx.bezierCurveTo(
      randomInt(WIDTH), randomInt(HEIGHT),
      randomInt(WIDTH), randomInt(HEIGHT),
      randomInt(WIDTH), randomInt(HEIGHT),
    );
    ctx.stroke();
  }

  // Characters — each rotated, sized, and baseline-offset independently
  const charWidth = WIDTH / (CODE_LENGTH + 1);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const x = charWidth * (i + 1);
    const wave = Math.sin(i * 1.3) * 10;
    const y = HEIGHT / 2 + wave;
    const angle = (randomInt(-25, 25) * Math.PI) / 180;
    const fontSize = randomInt(30, 42);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = randomColor(170, 255, 0.95);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char ?? "", 0, 0);
    ctx.restore();
  }

  // Noise dots in front
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = randomColor(80, 200, 0.5);
    ctx.fillRect(randomInt(WIDTH), randomInt(HEIGHT), 1, 1);
  }

  return canvas.toBuffer("image/png");
}

export interface CaptchaChallenge {
  challengeId: string;
  imagePngBase64: string;
  expiresInSeconds: number;
}

export async function createCaptchaChallenge(): Promise<CaptchaChallenge> {
  const text = randomText();
  const challengeId = randomUUID();
  const png = renderCaptchaPng(text);

  await redis.set(
    `captcha:${challengeId}`,
    hashAnswer(text),
    "EX",
    CHALLENGE_TTL_SECONDS,
  );

  return {
    challengeId,
    imagePngBase64: png.toString("base64"),
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  };
}

export async function verifyCaptchaChallenge(
  challengeId: string,
  answer: string,
): Promise<boolean> {
  const key = `captcha:${challengeId}`;
  const storedHash = await redis.get(key);
  // Single-use: delete regardless of outcome so a challenge can't be replayed.
  await redis.del(key);

  if (!storedHash) return false;
  return storedHash === hashAnswer(answer);
}
