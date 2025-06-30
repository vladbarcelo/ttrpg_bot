import { Module, Global } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

@Global()
@Module({
  providers: [
    {
      provide: 'ConfigService',
      useValue: {
        get(key: string, defaultValue?: string) {
          return process.env[key] || defaultValue;
        },
      },
    },
  ],
  exports: ['ConfigService'],
})
export class ConfigModule {}
