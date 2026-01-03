/** Error code subset matching tRPC codes used by services. */
export type ServiceErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "INTERNAL_SERVER_ERROR";

/**
 * Transport-agnostic domain error for service layer code.
 * The tRPC error middleware maps these to TRPCError automatically,
 * keeping services free of tRPC imports.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public code: ServiceErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ServiceError";
  }
}
