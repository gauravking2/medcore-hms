import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ok, paginated, parsePagination } from '../common/response';
import {
  CreateDepartmentDto,
  CreateDoctorDto,
  CreateHospitalDto,
  CreatePatientDto,
  InviteStaffDto,
  UpdateDepartmentDto,
  UpdateDoctorDto,
  UpdateHospitalDto,
  UpdatePatientDto,
  UpdateRoleDto,
  UpdateStatusDto,
} from './directory.dto';
import { DirectoryService } from './directory.service';

@ApiTags('directory')
@ApiBearerAuth()
@Controller()
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Post('hospitals')
  @Roles('SUPER_ADMIN')
  @UseGuards(RolesGuard)
  async createHospital(@Body() dto: CreateHospitalDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.directory.createHospital(dto, user, request.ip), 'Hospital created.');
  }

  @Get('hospitals')
  async listHospitals(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, search, skip } = parsePagination(query);
    const result = await this.directory.listHospitals(user, { page, limit, search, skip });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('hospitals/:id')
  async getHospital(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.directory.getHospital(id, user), 'OK');
  }

  @Patch('hospitals/:id')
  async updateHospital(
    @Param('id') id: string,
    @Body() dto: UpdateHospitalDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.directory.updateHospital(id, dto, user, request.ip), 'Hospital updated.');
  }

  @Post('hospitals/:id/status')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async updateHospitalStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.directory.updateHospitalStatus(id, dto.status, user, request.ip), 'Hospital status updated.');
  }

  @Post('hospitals/:hospitalId/departments')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async createDepartment(
    @Param('hospitalId') hospitalId: string,
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.directory.createDepartment(hospitalId, dto, user, request.ip), 'Department created.');
  }

  @Get('hospitals/:hospitalId/departments')
  async listDepartments(
    @Param('hospitalId') hospitalId: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ) {
    const { page, limit, search, skip } = parsePagination(query);
    const result = await this.directory.listDepartments(hospitalId, user, { page, limit, search, skip });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('departments/:id')
  async getDepartment(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.directory.getDepartment(id, user), 'OK');
  }

  @Patch('departments/:id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.directory.updateDepartment(id, dto, user, request.ip), 'Department updated.');
  }

  @Post('doctors')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async createDoctor(@Body() dto: CreateDoctorDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.directory.createDoctor(dto, user, request.ip), 'Doctor created.');
  }

  @Get('doctors')
  async listDoctors(@Query() query: Record<string, unknown> & { hospitalId?: string }, @CurrentUser() user: AuthContext) {
    const { page, limit, search, skip } = parsePagination(query);
    const result = await this.directory.listDoctors(user, {
      page,
      limit,
      search,
      skip,
      hospitalId: typeof query.hospitalId === 'string' ? query.hospitalId : undefined,
    });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('doctors/:id')
  async getDoctor(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.directory.getDoctor(id, user), 'OK');
  }

  @Patch('doctors/:id')
  async updateDoctor(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.directory.updateDoctor(id, dto, user, request.ip), 'Doctor updated.');
  }

  @Get('users')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async listUsers(@Query() query: Record<string, unknown> & { hospitalId?: string; role?: string }, @CurrentUser() user: AuthContext) {
    const { page, limit, search, skip } = parsePagination(query);
    const result = await this.directory.listUsers(user, {
      page,
      limit,
      search,
      skip,
      hospitalId: typeof query.hospitalId === 'string' ? query.hospitalId : undefined,
      role: typeof query.role === 'string' ? query.role : undefined,
    });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.directory.getUser(id, user), 'OK');
  }

  @Post('users/invite')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async inviteStaff(@Body() dto: InviteStaffDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.directory.inviteStaff(dto, user, request.ip), 'Staff invited.');
  }

  @Patch('users/:id/role')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.directory.updateUserRole(id, dto.role, user, request.ip), 'Role updated.');
  }

  @Post('patients')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE')
  @UseGuards(RolesGuard)
  async createPatient(@Body() dto: CreatePatientDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.directory.createPatient(dto, user, request.ip), 'Patient registered.');
  }

  @Get('patients')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'ACCOUNTANT')
  @UseGuards(RolesGuard)
  async listPatients(@Query() query: Record<string, unknown> & { hospitalId?: string }, @CurrentUser() user: AuthContext) {
    const { page, limit, search, skip } = parsePagination(query);
    const result = await this.directory.listPatients(user, {
      page,
      limit,
      search,
      skip,
      hospitalId: typeof query.hospitalId === 'string' ? query.hospitalId : undefined,
    });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('patients/:id')
  async getPatient(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.directory.getPatient(id, user), 'OK');
  }

  @Patch('patients/:id')
  async updatePatient(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: AuthContext,
    @Req() request: Request,
  ) {
    return ok(await this.directory.updatePatient(id, dto, user, request.ip), 'Patient updated.');
  }
}
