export class HttpError extends Error {
  constructor(status, message, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
