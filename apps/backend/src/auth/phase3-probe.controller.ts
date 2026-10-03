import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthContext } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@ApiBearerAuth()
@Controller('__phase3-probes')
export class Phase3ProbeController {
  @Get('admin-only')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @UseGuards(RolesGuard)
  adminOnly(@Req() request: Request & { user: AuthContext }) {
    return { success: true, data: { role: request.user.role }, message: 'OK' };
  }

  @Get('super-only')
  @Roles('SUPER_ADMIN')
  @UseGuards(RolesGuard)
  superOnly() {
    return { success: true, data: { ok: true }, message: 'OK' };
  }
}
