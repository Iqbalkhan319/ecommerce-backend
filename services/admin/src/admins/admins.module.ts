import { Module } from '@nestjs/common';
import { AdminsController } from './admins.controller';
import { RolesController } from './roles.controller';

@Module({ controllers: [AdminsController, RolesController] })
export class AdminsModule {}
