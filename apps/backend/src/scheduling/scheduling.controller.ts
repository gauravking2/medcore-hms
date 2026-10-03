import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ok, paginated, parsePagination } from '../common/response';
import { CreateAppointmentDto, CreateAvailabilityDto, UpdateAppointmentStatusDto, UpdateAvailabilityDto } from './scheduling.dto';
import { SchedulingService } from './scheduling.service';

@ApiTags('scheduling')
@ApiBearerAuth()
@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('doctors/:doctorId/availability')
  async listAvailability(@Param('doctorId') doctorId: string, @CurrentUser() user: AuthContext) {
    return ok(await this.scheduling.listAvailability(doctorId, user), 'OK');
  }

  @Post('doctors/:doctorId/availability')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR')
  @UseGuards(RolesGuard)
  async createAvailability(
    @Param('doctorId') doctorId: string,
    @Body() dto: CreateAvailabilityDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.scheduling.createAvailability(doctorId, dto, user, request.ip), 'Availability created.');
  }

  @Patch('doctors/:doctorId/availability/:id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR')
  @UseGuards(RolesGuard)
  async updateAvailability(
    @Param('doctorId') doctorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAvailabilityDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.scheduling.updateAvailability(doctorId, id, dto, user, request.ip), 'Availability updated.');
  }

  @Delete('doctors/:doctorId/availability/:id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR')
  @UseGuards(RolesGuard)
  async disableAvailability(@Param('doctorId') doctorId: string, @Param('id') id: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.scheduling.disableAvailability(doctorId, id, user, request.ip), 'Availability disabled.');
  }

  @Get('doctors/:doctorId/available-slots')
  async availableSlots(@Param('doctorId') doctorId: string, @Query('date') date: string, @CurrentUser() user: AuthContext) {
    return ok(await this.scheduling.availableSlots(doctorId, date, user), 'OK');
  }

  @Post('appointments')
  async createAppointment(@Body() dto: CreateAppointmentDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.scheduling.createAppointment(dto, user, request.ip), 'Appointment booked.');
  }

  @Get('appointments')
  async listAppointments(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip, search } = parsePagination(query);
    const get = (key: string): string | undefined => (typeof query[key] === 'string' ? (query[key] as string) : undefined);
    const result = await this.scheduling.listAppointments(user, {
      page,
      limit,
      skip,
      search,
      doctorId: get('doctorId'),
      patientId: get('patientId'),
      departmentId: get('departmentId'),
      status: get('status'),
      from: get('from') ?? get('dateFrom'),
      to: get('to') ?? get('dateTo'),
      hospitalId: get('hospitalId'),
    });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('appointments/:id')
  async getAppointment(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.scheduling.getAppointment(id, user), 'OK');
  }

  @Patch('appointments/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentStatusDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.scheduling.updateStatus(id, dto.status, user, request.ip), 'Appointment status updated.');
  }

  @Patch('appointments/:id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.scheduling.cancel(id, user, request.ip), 'Appointment cancelled.');
  }
}
