import { Elysia } from "elysia";
import { useAuth } from "../middleware";
import { VERSION } from "$/lib/version";

export const serverRoutes = new Elysia({
  name: "routes:server",
  prefix: "/_server",
})
  .use(useAuth)
  .get("", { auth: true }, () => ({ version: VERSION }));
