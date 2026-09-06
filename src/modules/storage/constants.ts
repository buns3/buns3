import { config } from "$/config";

export const BASE_PATH = config.DATA_PATH;
export const TEMP_DIR_NAME = ".tmp";
export const CLEANUP_OLDER_THAN_MS = 1000 * 60 * 60;
export const CLEANUP_INTERVAL_MS = 1000 * 60 * 15;
