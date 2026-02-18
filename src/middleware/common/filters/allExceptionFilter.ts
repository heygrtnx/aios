import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { capitalizedMessage } from '../../helpers';
import { CustomLoggerService } from 'src/lib/loggger/logger.service';
import { Prisma } from '../../../../generated/prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: CustomLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    let status: number;
    let message: any;
    let statusType: string;

    // Handle Prisma Client Known Request Errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma Known Errors
      status = HttpStatus.BAD_REQUEST;
      message = this.handlePrismaError(exception);
      statusType = HttpStatus[HttpStatus.BAD_REQUEST] || 'Bad Request';
    } else if (exception instanceof HttpException) {
      // Handle standard HTTP exceptions
      status = exception.getStatus();
      const responseMessage = exception.getResponse();
      message =
        typeof responseMessage === 'string'
          ? responseMessage
          : (responseMessage as any).message || 'Unknown error';
      statusType = HttpStatus[status] || 'Unknown Error';
    } else if (exception instanceof Error) {
      // Check if it's a Stripe error by checking the error properties
      // Stripe errors have specific properties like 'type', 'code', or constructor name
      const error = exception as any;
      const isStripeError =
        error.type?.startsWith('Stripe') ||
        error.code?.startsWith('card_') ||
        error.code?.startsWith('payment_') ||
        error.code?.startsWith('invalid_') ||
        error.constructor?.name === 'StripeAPIError' ||
        error.constructor?.name === 'StripeCardError' ||
        error.constructor?.name === 'StripeInvalidRequestError' ||
        error.constructor?.name?.includes('Stripe');

      if (isStripeError) {
        // Handle Stripe errors - return the actual error message
        status = HttpStatus.BAD_REQUEST;
        message = exception.message || 'Payment processing error';
        statusType = HttpStatus[HttpStatus.BAD_REQUEST] || 'Bad Request';
      } else {
        // Generic error - return the actual error message instead of "Internal server error"
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = exception.message || 'Internal server error';
        statusType = 'Internal Server Error';
      }
    } else {
      // Handle other exceptions (e.g. Internal Server Error)
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      statusType = 'Internal Server Error';
    }

    // Create the error response object, including timestamp and path
    const errorResponse = {
      statusCode: status,
      statusType,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Log the error using the custom logger
    this.logger.error(
      `Exception: ${JSON.stringify(errorResponse)}`,
      exception instanceof Error ? (exception.stack ?? '') : '',
    );

    // Send the structured error response to the client
    response.status(status).json(errorResponse);
  }

  // Handle Prisma errors and provide meaningful messages
  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): string {
    switch (exception.code) {
      case 'P2002': {
        // Unique constraint violation
        // Prisma v5 meta.target is unknown, so do our best
        const target = Array.isArray((exception.meta as any)?.target)
          ? ((exception.meta as any).target[0] as string)
          : typeof (exception.meta as any)?.target === 'string'
            ? (exception.meta as any).target
            : '';
        return `${capitalizedMessage(target)} already exists`;
      }
      case 'P2003': {
        // Foreign key violation
        // field_name may be missing or meta may be {} so fallback to empty string
        const field =
          typeof (exception.meta as any)?.field_name === 'string'
            ? (exception.meta as any).field_name
            : '';
        return `${capitalizedMessage(field)} key relationship not found`;
      }
      case 'P2025': // Record not found
        return 'The record was not found';
      default: // Database error
        return 'Database error occurred';
    }
  }
}
