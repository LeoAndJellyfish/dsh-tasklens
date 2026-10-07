import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "tasklens";
export declare const inject: string[];
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    intervalSeconds: Schema<number, number, "defined">;
    minGapSeconds: Schema<number, number, "defined">;
    maxCallsPerHour: Schema<number, number, "defined">;
    detail: Schema<"brief" | "standard" | "detailed", "brief" | "standard" | "detailed", "defined">;
    audience: Schema<"overview" | "technical", "overview" | "technical", "defined">;
    inputBudget: Schema<number, number, "defined">;
    maxTokensPerHour: Schema<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    intervalSeconds: Schema<number, number, "defined">;
    minGapSeconds: Schema<number, number, "defined">;
    maxCallsPerHour: Schema<number, number, "defined">;
    detail: Schema<"brief" | "standard" | "detailed", "brief" | "standard" | "detailed", "defined">;
    audience: Schema<"overview" | "technical", "overview" | "technical", "defined">;
    inputBudget: Schema<number, number, "defined">;
    maxTokensPerHour: Schema<number, number, "defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config?: unknown): Promise<void>;
