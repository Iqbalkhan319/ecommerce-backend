import { Controller, Get, HttpCode, Res, type Type } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { RawResponse } from '../http/response.interceptor';
import { HealthRegistry } from './health.registry';

export function createHealthController(): Type<unknown> {
  @ApiTags('health')
  @Controller('health')
  class HealthController {
    constructor(private readonly registry: HealthRegistry) {}

    @Get()
    @Public()
    @RawResponse()
    @ApiOperation({ summary: 'Aggregated service and dependency health' })
    async health(@Res({ passthrough: true }) response: Response) {
      const report = await this.registry.report();
      response.status(report.status === 'error' ? 503 : 200);
      return report;
    }

    @Get('live')
    @Public()
    @RawResponse()
    @HttpCode(200)
    @ApiOperation({ summary: 'Liveness probe: the process is running and able to serve traffic' })
    live(@Res({ passthrough: true }) response: Response) {
      const result = this.registry.liveness();
      response.status(result.status === 'ok' ? 200 : 503);
      return result;
    }

    @Get('ready')
    @Public()
    @RawResponse()
    @ApiOperation({ summary: 'Readiness probe: every critical dependency is reachable' })
    async ready(@Res({ passthrough: true }) response: Response) {
      const report = await this.registry.report();
      response.status(report.status === 'error' ? 503 : 200);
      return report;
    }
  }

  return HealthController;
}
