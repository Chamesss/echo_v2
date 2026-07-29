import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { paths } from "@/lib/paths";

/**
 * Top-level `errorElement` for the route tree. Catches render/loader errors and
 * failed lazy chunk loads anywhere below the root layout and shows a calm
 * fallback with a way home, instead of a blank screen or React's dev overlay.
 */
export function RouteError() {
  const error = useRouteError();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Something went wrong";

  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : ""
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
        <Link
          to={paths.home}
          className="mt-4 inline-block text-sm font-medium text-foreground underline underline-offset-4"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
