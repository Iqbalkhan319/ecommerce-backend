import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors, PERMISSIONS } from '@ecom/platform';
import { DashboardService } from './dashboard.service';
import { RequirePermissions } from '../authz/permissions.decorator';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.dashboardRead)
  @ApiOperation({
    summary: 'Operational summary: order pipeline, revenue, catalogue health and recent activity',
    description: 'Revenue excludes rejected and cancelled orders, which never represent money owed.',
  })
  summary() {
    return this.dashboard.summary();
  }
}
