import type { AppServer } from "$/modules/http/types";
import type { BunRequest } from "bun";

export type Middleware<TRequest, TContext, TServer, TOut> = (
  req: TRequest,
  ctx: TContext,
  server: TServer,
) => MaybePromise<Response | TOut>;

export type MaybePromise<T> = T | Promise<T>;

export type NeverFixup<T> = [T] extends [never] ? {} : T;

export type ExtractOut<T> =
  T extends Middleware<any, any, any, infer TOut>
    ? NeverFixup<Exclude<Awaited<TOut>, Response | null | undefined | void>>
    : never;

export type PrettyObject<T extends {}> = { [K in keyof T]: T[K] } & {};

type InternalFold<T> = T extends readonly [infer THead, ...infer TRest]
  ? ExtractOut<THead> & InternalFold<TRest>
  : {};

export type Fold<T> = PrettyObject<InternalFold<T>>;

export function withMiddleware<
  const TMiddlewares extends readonly Middleware<
    TRequest,
    any,
    AppServer,
    any
  >[],
  TRequest extends BunRequest,
>(
  middlewares: TMiddlewares,
  handler: (
    req: TRequest,
    ctx: Fold<TMiddlewares>,
    server: AppServer,
  ) => MaybePromise<Response>,
) {
  return async (req: TRequest, server: AppServer) => {
    let ctx: Record<string, any> = {};
    for (const mw of middlewares) {
      const result = await mw(req, ctx, server);
      if (result instanceof Response) {
        return result;
      }

      ctx = {
        ...ctx,
        ...result,
      };
    }

    return handler(req, ctx as PrettyObject<Fold<TMiddlewares>>, server);
  };
}
