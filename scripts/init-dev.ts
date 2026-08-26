import { bucketStorage } from "$/modules/storage/bucket";
import { fileStorage } from "../src/modules/storage/file-storage";

try {
  console.log("Initializing file storage...");
  await fileStorage.init();
  console.log("Initializing file storage... [DONE]");
} catch {
  console.error("Initializing file storage... [FAIL]");
}

try {
  console.log("Creating DEV bucket...");
  const result = await bucketStorage.create("dev");
  if (!result.success) {
    console.warn("WARNING:", result.code);
    console.warn("Creating DEV bucket... [FAIL]");
  } else {
    console.log(
      `${result.bucket.name} - ${result.bucket.createdAt.toLocaleString()}`,
    );
    console.log("Creating DEV bucket... [DONE]");
  }
} catch (err) {
  console.error("Creating DEV bucket... [FAIL]");
}
