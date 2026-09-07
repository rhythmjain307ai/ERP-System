class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

class ValidationError extends ApiError {
  constructor(message, details) {
    super(400, message, details);
  }
}

class NotFoundError extends ApiError {
  constructor(resource) {
    super(404, `${resource} not found`);
  }
}

module.exports = { ApiError, ValidationError, NotFoundError };