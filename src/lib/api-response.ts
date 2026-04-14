import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

/**
 * Standard success response format for all API routes
 * Wraps response data with metadata (timestamp, requestId)
 */
export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
    },
    { status }
  );
}

/**
 * Standard error response format for all API routes
 * Wraps error with metadata and standardized error codes
 */
export function errorResponse(
  code: string,
  message: string,
  status = 500
) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
    },
    { status }
  );
}

/**
 * Map common error types to HTTP status codes
 */
export const ErrorCodes = {
  INVALID_INPUT: 400,
  AUTH_FAILED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
