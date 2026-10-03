import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ok, paginated, parsePagination } from '../common/response';
import { InsightsService, parseDateRange } from './insights.service';

@ApiTags('insights')
@ApiBearerAuth()
@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('analytics/overview')
  async overview(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ) {
    const range = parseDateRange(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    return ok(await this.insights.overview(user, hospitalId, range), 'OK');
  }

  @Get('analytics/revenue')
  async revenue(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const range = parseDateRange(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const overview = await this.insights.overview(user, hospitalId, range);
    if ('revenue' in overview) return ok(overview.revenue, 'OK');
    return ok(overview, 'OK');
  }

  @Get('analytics/appointments')
  async appointments(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const range = parseDateRange(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const overview = await this.insights.overview(user, hospitalId, range);
    if ('appointments' in overview) return ok(overview.appointments, 'OK');
    return ok(overview, 'OK');
  }

  @Get('search')
  async search(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const entity = typeof query.entity === 'string' ? query.entity : '';
    const term = typeof query.q === 'string' ? query.q : typeof query.term === 'string' ? query.term : '';
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const filters: Record<string, string | undefined> = {};
    for (const key of ['specialization', 'departmentId', 'dosageForm', 'activeOnly', 'lowStock', 'expiring']) {
      filters[key] = typeof query[key] === 'string' ? (query[key] as string) : undefined;
    }
    const result = await this.insights.search(user, entity, term, hospitalId, { page, limit, skip }, filters);
    return paginated(result.items as Record<string, unknown>[], page, limit, result.total);
  }

  @Get('activity')
  async activity(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const hospitalId = typeof query.hospitalId === 'string' ? query.hospitalId : undefined;
    const result = await this.insights.activity(user, hospitalId, { page, limit, skip });
    return paginated(result.items, page, limit, result.total);
  }
}
