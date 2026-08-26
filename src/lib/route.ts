type KeyExtractResult =
  | {
      success: true;
      key: string;
    }
  | {
      success: false;
    };

export function extractKey(url: string): KeyExtractResult {
  try {
    const pathname = new URL(url).pathname;
    const [, , ...keyArr] = pathname.split("/");
    const key = keyArr.map(decodeURIComponent).join("/");
    if (key === "") {
      return { success: false };
    }

    return {
      success: true,
      key,
    };
  } catch {
    return { success: false };
  }
}
