import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiException');

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse();
    const request = context.getRequest<Request>();
    const nodeError = exception as NodeJS.ErrnoException | null;

    if (nodeError?.code === 'DUPLICATE_EMAIL') {
      return response.status(HttpStatus.CONFLICT).json({ success: false, error: { code: 'DUPLICATE_EMAIL', message: 'An account with this email already exists.' } });
    }
    if (nodeError?.code === 'INVALID_CREDENTIALS') {
      return response.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }
    if (nodeError?.code === 'FORBIDDEN_ROLE') {
      return response.status(HttpStatus.FORBIDDEN).json({ success: false, error: { code: 'FORBIDDEN_ROLE', message: 'Registration is restricted for this role.' } });
    }
    if (nodeError?.code === 'HOSPITAL_REQUIRED') {
      return response.status(HttpStatus.BAD_REQUEST).json({ success: false, error: { code: 'HOSPITAL_REQUIRED', message: 'hospitalSlug is required for hospital roles.' } });
    }
    if (nodeError?.code === 'HOSPITAL_NOT_FOUND') {
      return response.status(HttpStatus.NOT_FOUND).json({ success: false, error: { code: 'HOSPITAL_NOT_FOUND', message: 'Hospital not found.' } });
    }
    if (nodeError?.code === 'REFRESH_REQUIRED' || nodeError?.code === 'REFRESH_INVALID' || nodeError?.code === 'REFRESH_REUSED' || nodeError?.code === 'SESSION_EXPIRED') {
      return response.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: { code: nodeError.code, message: (nodeError as Error).message } });
    }
    if (nodeError?.code === 'SLOT_UNAVAILABLE' || nodeError?.code === 'PATIENT_DOUBLE_BOOKED' || nodeError?.code === 'OUTSIDE_AVAILABILITY' || nodeError?.code === 'SCHEDULE_OVERLAP' || nodeError?.code === 'INVALID_SCHEDULE' || nodeError?.code === 'INVALID_TRANSITION' || nodeError?.code === 'INVALID_LAB_TRANSITION' || nodeError?.code === 'INSUFFICIENT_STOCK' || nodeError?.code === 'NEGATIVE_STOCK' || nodeError?.code === 'INVALID_RESULT' || nodeError?.code === 'INVALID_QUANTITY' || nodeError?.code === 'INVALID_DATES') {
      const status = nodeError.code === 'SLOT_UNAVAILABLE' || nodeError.code === 'PATIENT_DOUBLE_BOOKED' || nodeError.code === 'SCHEDULE_OVERLAP' || nodeError.code === 'INSUFFICIENT_STOCK' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      return response.status(status).json({ success: false, error: { code: nodeError.code, message: (nodeError as Error).message } });
    }
    if (nodeError?.code === 'WEBHOOK_SIGNATURE_INVALID') {
      return response.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature.' } });
    }
    if (nodeError?.code === 'INVALID_INVOICE_TRANSITION' || nodeError?.code === 'INVOICE_EXISTS' || nodeError?.code === 'INVOICE_EMPTY' || nodeError?.code === 'INVOICE_NOT_PAYABLE' || nodeError?.code === 'ALREADY_PAID' || nodeError?.code === 'CASH_VIA_COUNTER' || nodeError?.code === 'INVALID_AMOUNT') {
      const status = nodeError.code === 'INVOICE_EXISTS' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      return response.status(status).json({ success: false, error: { code: nodeError.code, message: (nodeError as Error).message } });
    }
    if (nodeError?.code === 'INVALID_RANGE' || nodeError?.code === 'UNKNOWN_ENTITY') {
      return response.status(HttpStatus.BAD_REQUEST).json({ success: false, error: { code: nodeError.code, message: (nodeError as Error).message } });
    }
    if (nodeError?.code === 'RESET_INVALID') {
      return response.status(HttpStatus.BAD_REQUEST).json({ success: false, error: { code: nodeError.code, message: (nodeError as Error).message } });
    }
    if (nodeError?.code === 'NOT_FOUND') {
      return response.status(HttpStatus.NOT_FOUND).json({ success: false, error: { code: 'NOT_FOUND', message: (nodeError as Error).message } });
    }
    if (nodeError?.code === 'ACCOUNT_INACTIVE') {
      return response.status(HttpStatus.BAD_REQUEST).json({ success: false, error: { code: nodeError.code, message: (nodeError as Error).message } });
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse() as { success?: boolean; error?: { code: string; message: string }; message?: unknown };
      if (payload && typeof payload === 'object' && payload.success === false && payload.error) {
        return response.status(exception.getStatus()).json(payload);
      }
      const status = exception.getStatus();
      const message = Array.isArray(payload?.message) ? payload.message.join('; ') : 'Request validation failed.';
      const code = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
      return response.status(status).json({ success: false, error: { code, message } });
    }

    this.logger.error(`Unhandled error on ${request.method} ${request.url}: ${(exception as Error)?.message ?? 'unknown'}`);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  }
}
