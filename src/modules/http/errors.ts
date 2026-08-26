import type { Buns3ErrorCode } from "$/modules/storage/errors";

export function errorResponse(code: Buns3ErrorCode) {
  switch (code) {
    case "KEY_NOT_FOUND":
      return Response.json({ code }, { status: 404 });

    case "BUCKET_NOT_FOUND":
      return Response.json({ code }, { status: 404 });

    case "BUCKET_ALREADY_EXIST":
      return Response.json({ code }, { status: 400 });

    case "FS_ERROR":
      return Response.json({ code }, { status: 500 });

    case "UNKNOWN":
    default:
      return Response.json({ code: code ?? "UNKNOWN" }, { status: 500 });
  }
}
