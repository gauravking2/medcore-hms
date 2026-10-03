import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ok, paginated, parsePagination } from '../common/response';
import { CreateBatchDto, CreateLabOrderDto, CreateLabTestDto, CreateMedicineDto, DispenseDto, QuarantineDto, UpdateLabTestDto, UpdateMedicineDto, UploadLabResultDto } from './care.dto';
import { CareService } from './care.service';
import { UpdateLabOrderStatusDto } from './care.dto';

@ApiTags('care')
@ApiBearerAuth()
@Controller()
export class CareController {
  constructor(private readonly care: CareService) {}

  @Post('lab-tests')
  async createLabTest(@Body() dto: CreateLabTestDto, @Query('hospitalId') hospitalId: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.createLabTest(dto, user, hospitalId, request.ip), 'Lab test created.');
  }

  @Get('lab-tests')
  async listLabTests(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip, search } = parsePagination(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const result = await this.care.listLabTests(user, hospitalId, { page, limit, skip, search });
    return paginated(result.items, page, limit, result.total);
  }

  @Patch('lab-tests/:id')
  async updateLabTest(@Param('id') id: string, @Body() dto: UpdateLabTestDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.updateLabTest(id, dto, user, request.ip), 'Lab test updated.');
  }

  @Post('lab-orders')
  async createLabOrder(@Body() dto: CreateLabOrderDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.createLabOrder(dto, user, request.ip), 'Lab order created.');
  }

  @Get('lab-orders')
  async listLabOrders(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip, search } = parsePagination(query);
    const get = (key: string): string | undefined => (typeof query[key] === 'string' ? (query[key] as string) : undefined);
    const result = await this.care.listLabOrders(user, { page, limit, skip, search, status: get('status'), patientId: get('patientId'), hospitalId: get('hospitalId') });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('lab-orders/:id')
  async getLabOrder(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.care.getLabOrder(id, user), 'OK');
  }

  @Patch('lab-orders/:id/status')
  async updateLabOrderStatus(@Param('id') id: string, @Body() dto: UpdateLabOrderStatusDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.updateLabOrderStatus(id, dto.status, user, request.ip), 'Lab order status updated.');
  }

  @Patch('lab-orders/:id/result')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  async uploadLabResult(
    @Param('id') id: string,
    @Body() dto: UploadLabResultDto,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.care.uploadLabResult(id, dto, file, user, request.ip), 'Lab result uploaded.');
  }

  @Post('lab-orders/:id/approve')
  async approveLabOrder(@Param('id') id: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.approveLabOrder(id, user, request.ip), 'Lab report approved.');
  }

  @Post('medicines')
  async createMedicine(@Body() dto: CreateMedicineDto, @Query('hospitalId') hospitalId: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.createMedicine(dto, user, hospitalId, request.ip), 'Medicine created.');
  }

  @Get('medicines')
  async listMedicines(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip, search } = parsePagination(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const result = await this.care.listMedicines(user, hospitalId, { page, limit, skip, search });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('medicines/:id')
  async getMedicine(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.care.getMedicine(id, user), 'OK');
  }

  @Patch('medicines/:id')
  async updateMedicine(@Param('id') id: string, @Body() dto: UpdateMedicineDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.updateMedicine(id, dto, user, request.ip), 'Medicine updated.');
  }

  @Get('inventory')
  async listInventory(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip, search } = parsePagination(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const result = await this.care.listInventory(user, hospitalId, { page, limit, skip, search });
    return paginated(result.items, page, limit, result.total);
  }

  @Post('inventory/batches')
  async createBatch(@Body() dto: CreateBatchDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.createBatch(dto, user, request.ip), 'Batch received.');
  }

  @Patch('inventory/batches/:id/quarantine')
  async quarantine(@Param('id') id: string, @Body() dto: QuarantineDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.quarantineBatch(id, dto.quarantined ?? true, user, request.ip), 'Batch quarantine updated.');
  }

  @Get('pharmacy/low-stock')
  async lowStock(@Query('hospitalId') hospitalId: string | undefined, @CurrentUser() user: AuthContext) {
    const result = await this.care.lowStock(user, hospitalId);
    return ok(result.items, 'OK');
  }

  @Get('pharmacy/expiring')
  async expiring(@Query('hospitalId') hospitalId: string | undefined, @Query('withinDays') withinDays: string | undefined, @CurrentUser() user: AuthContext) {
    const result = await this.care.expiring(user, hospitalId, withinDays ? Number(withinDays) : 30);
    return ok(result.items, 'OK');
  }

  @Get('pharmacy/prescriptions')
  async validPrescriptions(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const result = await this.care.validPrescriptions(user, hospitalId, { page, limit, skip });
    return paginated(result.items, page, limit, result.total);
  }

  @Post('pharmacy/prescriptions/:id/dispense')
  async dispense(@Param('id') id: string, @Body() dto: DispenseDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.care.dispense(id, dto, user, request.ip), 'Dispensed.');
  }

  @Get('pharmacy/expiry-report')
  async expiryReport(@Query('hospitalId') hospitalId: string | undefined, @Query('withinDays') withinDays: string | undefined, @CurrentUser() user: AuthContext) {
    const result = await this.care.expiryReport(user, hospitalId, withinDays ? Number(withinDays) : 30);
    return ok(result.items, 'OK');
  }
}
