import { type } from "arktype";

export const Key = type(/^(?!\/+$)[^\u0000-\u001F\u007F]{1,1024}$/);
