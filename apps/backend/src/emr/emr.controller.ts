import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ok, paginated, parsePagination } from '../common/response';
import { AppendEmrEntryDto, CreateEmrDto, CreatePrescriptionDto, RecordVitalsDto } from './emr.dto';
import { EmrService } from './emr.service';

@ApiTags('emr')
@ApiBearerAuth()
@Controller()
export class EmrController {
  constructor(private readonly emr: EmrService) {}

  @Post('medical-records')
  async createRecord(@Body() dto: CreateEmrDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.emr.createRecord(dto, user, request.ip), 'Encounter started.');
  }

  @Get('medical-records/:id')
  async getRecord(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.emr.getRecord(id, user), 'OK');
  }

  @Get('medical-records/patient/:patientId')
  async recordsForPatient(@Param('patientId') patientId: string, @Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const result = await this.emr.recordsForPatient(patientId, user, { page, limit, skip });
    return paginated(result.items, page, limit, result.total);
  }

  @Patch('medical-records/:id')
  async updateRecord(@Param('id') id: string, @Body() dto: Partial<CreateEmrDto>, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.emr.updateRecord(id, dto, user, request.ip), 'Record updated (append-only history preserved).');
  }

  @Post('medical-records/:id/entries')
  async appendEntry(@Param('id') id: string, @Body() dto: AppendEmrEntryDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.emr.appendEntry(id, dto, user, request.ip), 'Entry appended.');
  }

  @Post('medical-records/:id/vitals')
  async recordVitals(@Param('id') id: string, @Body() dto: RecordVitalsDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.emr.recordVitals(id, dto, user, request.ip), 'Vitals recorded.');
  }

  @Post('medical-records/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.emr.uploadAttachment(id, file, user, request.ip), 'Attachment stored.');
  }

  @Post('prescriptions')
  async createPrescription(@Body() dto: CreatePrescriptionDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.emr.createPrescription(dto, user, request.ip), 'Prescription created.');
  }

  @Get('prescriptions/:id')
  async getPrescription(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.emr.getPrescription(id, user), 'OK');
  }

  @Get('prescriptions/patient/:patientId')
  async prescriptionsForPatient(@Param('patientId') patientId: string, @Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const result = await this.emr.prescriptionsForPatient(patientId, user, { page, limit, skip });
    return paginated(result.items, page, limit, result.total);
  }

  @Post('doctors/me/signature')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  async uploadSignature(
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.emr.uploadSignature(file, user, request.ip), 'Signature stored.');
  }

  @Get('prescriptions/:id/pdf')
  async prescriptionPdf(@Param('id') id: string, @CurrentUser() user: AuthContext, @Res() response: Response) {
    const pdf = await this.emr.prescriptionPdf(id, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="prescription-${id}.pdf"`);
    response.send(Buffer.from(pdf));
  }
}
