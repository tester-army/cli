import { NextRequest, NextResponse } from "next/server"
import { access, readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { tmpdir } from "node:os"

type ApiResponse = {
  ok: boolean
  message?: string
}

const SAFE_ARTIFACT_DIR = `${resolve(tmpdir(), "tester-army", "sessions")}${process.platform === "win32" ? "\\" : "/"}`

function extensionMime(ext: string) {
  switch (ext) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".svg":
      return "image/svg+xml"
    case ".bmp":
      return "image/bmp"
    default:
      return "application/octet-stream"
  }
}

function isSafePath(path: string) {
  const candidate = resolve(path)
  if (!candidate.startsWith(SAFE_ARTIFACT_DIR)) {
    return false
  }

  return candidate
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("path")
  if (!target) {
    return NextResponse.json<ApiResponse>({ ok: false, message: "Missing artifact path" }, { status: 400 })
  }

  const absolute = isSafePath(target)
  if (!absolute) {
    return NextResponse.json<ApiResponse>({ ok: false, message: "Invalid artifact path" }, { status: 403 })
  }

  try {
    await access(absolute)
    const stats = await stat(absolute)
    if (!stats.isFile()) {
      return NextResponse.json<ApiResponse>({ ok: false, message: "Artifact is not a file" }, { status: 400 })
    }

      const dot = target.lastIndexOf(".")
      const ext = dot >= 0 ? target.slice(dot).toLowerCase() : ""
      const bytes = await readFile(absolute)
      const contentType = extensionMime(ext)

    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch {
    return NextResponse.json<ApiResponse>({ ok: false, message: "Artifact not found" }, { status: 404 })
  }
}
