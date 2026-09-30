import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_ELEVENLABS_BASE_URL;
    return raw.replace(/\/+$/, "");
}

function getRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** ElevenLabs 的报错是 { detail: { status, message } }，detail 偶尔直接是字符串。 */
function upstreamErrorMessage(payload: unknown, fallback: string): string {
    const root = getRecord(payload);
    const detail = root.detail;
    if (typeof detail === "string" && detail) return detail;
    const detailRecord = getRecord(detail);
    if (typeof detailRecord.message === "string" && detailRecord.message) return detailRecord.message;
    if (typeof root.message === "string" && root.message) return root.message;
    return fallback;
}

function extractVoices(payload: unknown): { id: string; name: string }[] {
    const root = getRecord(payload);
    const source = Array.isArray(root.voices) ? root.voices : [];
    return source.flatMap(item => {
        const record = getRecord(item);
        const rawVoiceId = record.voice_id ?? record.id;
        if (typeof rawVoiceId !== "string" || !rawVoiceId.trim()) return [];
        const voiceId = rawVoiceId.trim();
        const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : voiceId;
        const category = typeof record.category === "string" ? record.category.trim() : "";
        return [{
            id: voiceId,
            name: category ? `${name}（${voiceId} · ${category}）` : `${name}（${voiceId}）`,
        }];
    });
}

export async function POST(request: Request) {
    try {
        return await handleGetVoices(request);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "get_voice_failed", message: message.slice(0, 500) }, { status: 502 });
    }
}

async function handleGetVoices(request: Request) {
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const baseUrl = normalizeBaseUrl(body.baseUrl);

    if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 400 });

    const response = await proxyFetch(`${baseUrl}/voices`, {
        headers: {
            "xi-api-key": apiKey,
            Accept: "application/json",
        },
    });

    const text = await response.text();
    let data: unknown = null;
    try {
        data = JSON.parse(text);
    } catch {
        return NextResponse.json({ error: "upstream_not_json", message: text.slice(0, 500) }, { status: 502 });
    }

    if (!response.ok) {
        return NextResponse.json(
            { error: "get_voice_failed", message: upstreamErrorMessage(data, text.slice(0, 500) || `HTTP ${response.status}`) },
            { status: 502 },
        );
    }

    return NextResponse.json({ ok: true, voices: extractVoices(data) });
}
