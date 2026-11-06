CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"bettor_name" text NOT NULL,
	"bettor_name_key" text NOT NULL,
	"fivem_id" text,
	"identity_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bets_request_id_key" UNIQUE("request_id"),
	CONSTRAINT "bets_one_per_player_per_race" UNIQUE("race_id","identity_key"),
	CONSTRAINT "bets_amount_positive" CHECK ("bets"."amount" > 0 and "bets"."amount" <= 1000000000000),
	CONSTRAINT "bets_identity_prefix" CHECK ("bets"."identity_key" ~ '^(fivem|name):.+')
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"number" integer,
	"final_position" integer,
	"is_winner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_race_name_key" UNIQUE("race_id","name_key"),
	CONSTRAINT "drivers_id_race_key" UNIQUE("id","race_id"),
	CONSTRAINT "drivers_number_range" CHECK ("drivers"."number" is null or "drivers"."number" between 0 and 9999),
	CONSTRAINT "drivers_position_range" CHECK ("drivers"."final_position" is null or "drivers"."final_position" >= 1),
	CONSTRAINT "drivers_name_not_blank" CHECK (length(btrim("drivers"."name")) between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "operation_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"race_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_closures" (
	"race_id" uuid PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_pool" bigint NOT NULL,
	"bet_count" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"driver_pools" jsonb NOT NULL,
	CONSTRAINT "race_closures_pool_nonneg" CHECK ("race_closures"."total_pool" >= 0)
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"race_id" uuid PRIMARY KEY NOT NULL,
	"winner_driver_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_pool" bigint NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission_amount" bigint NOT NULL,
	"distributable_pool" bigint NOT NULL,
	"winner_pool" bigint NOT NULL,
	"winners_count" integer NOT NULL,
	"total_payout" bigint NOT NULL,
	"organizer_kept" bigint NOT NULL,
	"no_winner" boolean NOT NULL,
	CONSTRAINT "race_results_balance" CHECK ("race_results"."total_payout" + "race_results"."organizer_kept" = "race_results"."total_pool"),
	CONSTRAINT "race_results_nonneg" CHECK ("race_results"."total_payout" >= 0 and "race_results"."organizer_kept" >= 0)
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scheduled_at" timestamp with time zone,
	"commission_bps" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"result_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "races_commission_range" CHECK ("races"."commission_bps" between 0 and 10000),
	CONSTRAINT "races_name_not_blank" CHECK (length(btrim("races"."name")) between 1 and 120),
	CONSTRAINT "races_status_valid" CHECK ("races"."status" in ('draft','open','closed','result','paid','cancelled','refunded'))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"bet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_due" bigint NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "settlements_one_per_bet" UNIQUE("bet_id"),
	CONSTRAINT "settlements_kind_valid" CHECK ("settlements"."kind" in ('payout','refund')),
	CONSTRAINT "settlements_status_valid" CHECK ("settlements"."status" in ('pending','paid')),
	CONSTRAINT "settlements_due_nonneg" CHECK ("settlements"."amount_due" >= 0),
	CONSTRAINT "settlements_paid_consistent" CHECK (("settlements"."status" = 'pending' and "settlements"."amount_paid" = 0 and "settlements"."paid_at" is null) or ("settlements"."status" = 'paid' and "settlements"."amount_paid" = "settlements"."amount_due" and "settlements"."paid_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_driver_same_race_fk" FOREIGN KEY ("driver_id","race_id") REFERENCES "public"."drivers"("id","race_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_closures" ADD CONSTRAINT "race_closures_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_winner_driver_id_drivers_id_fk" FOREIGN KEY ("winner_driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bets_race_idx" ON "bets" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "bets_driver_idx" ON "bets" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_race_number_key" ON "drivers" USING btree ("race_id","number") WHERE "drivers"."number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_race_position_key" ON "drivers" USING btree ("race_id","final_position") WHERE "drivers"."final_position" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_one_winner_per_race" ON "drivers" USING btree ("race_id") WHERE "drivers"."is_winner";--> statement-breakpoint
CREATE INDEX "operation_log_race_idx" ON "operation_log" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "operation_log_created_idx" ON "operation_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "races_status_idx" ON "races" USING btree ("status");--> statement-breakpoint
CREATE INDEX "races_created_idx" ON "races" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "settlements_race_idx" ON "settlements" USING btree ("race_id");