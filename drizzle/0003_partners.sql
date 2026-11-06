CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_name" text NOT NULL,
	"share_bps" integer NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "partner_payouts_one_per_race" UNIQUE("race_id","partner_id"),
	CONSTRAINT "partner_payouts_amount_nonneg" CHECK ("partner_payouts"."amount" >= 0),
	CONSTRAINT "partner_payouts_status_valid" CHECK ("partner_payouts"."status" in ('pending','paid')),
	CONSTRAINT "partner_payouts_paid_consistent" CHECK (("partner_payouts"."status" = 'pending' and "partner_payouts"."paid_at" is null) or ("partner_payouts"."status" = 'paid' and "partner_payouts"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"share_bps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_position_key" UNIQUE("position"),
	CONSTRAINT "partners_position_range" CHECK ("partners"."position" between 1 and 4),
	CONSTRAINT "partners_share_range" CHECK ("partners"."share_bps" between 0 and 10000),
	CONSTRAINT "partners_name_not_blank" CHECK (length(btrim("partners"."name")) between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_payouts_race_idx" ON "partner_payouts" USING btree ("race_id");--> statement-breakpoint

-- Quatre associés par défaut, parts égales (modifiables depuis l'onglet Comptabilité).
INSERT INTO "partners" ("position", "name", "share_bps") VALUES
  (1, 'Associé 1', 2500), (2, 'Associé 2', 2500), (3, 'Associé 3', 2500), (4, 'Associé 4', 2500);
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- PARTS D'ASSOCIÉS : montant figé ; seul le passage "pending" -> "paid" est possible, une fois.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_partner_payouts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF racebet_maintenance() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RB_PARTNER_PAYOUT_IMMUTABLE: une part d''associé ne peut pas être supprimée' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.race_id, NEW.partner_id, NEW.partner_name, NEW.share_bps, NEW.amount, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.race_id, OLD.partner_id, OLD.partner_name, OLD.share_bps, OLD.amount, OLD.created_at) THEN
    RAISE EXCEPTION 'RB_PARTNER_PAYOUT_IMMUTABLE: répartition figée, montant immuable' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'RB_ALREADY_PAID: part déjà versée' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER partner_payouts_guard
  BEFORE UPDATE OR DELETE ON partner_payouts
  FOR EACH ROW EXECUTE FUNCTION racebet_partner_payouts_guard();
--> statement-breakpoint

-- Suppression d'une course : refusée aussi tant que des parts d'associés restent à verser.
CREATE OR REPLACE FUNCTION racebet_purge_race(p_race uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s text;
  n_bets int;
  n_pending int;
  n_partner_pending int;
BEGIN
  SELECT status INTO s FROM races WHERE id = p_race FOR UPDATE;
  IF s IS NULL THEN
    RAISE EXCEPTION 'RB_RACE_NOT_FOUND: course introuvable' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n_bets FROM bets WHERE race_id = p_race;
  SELECT count(*) INTO n_pending FROM settlements WHERE race_id = p_race AND status = 'pending';
  SELECT count(*) INTO n_partner_pending FROM partner_payouts WHERE race_id = p_race AND status = 'pending';
  IF s = 'result' OR n_pending > 0 THEN
    RAISE EXCEPTION 'RB_RACE_NOT_DELETABLE: des paiements ou remboursements sont encore dus sur cette course' USING ERRCODE = 'P0001';
  END IF;
  IF s IN ('open', 'closed') AND n_bets > 0 THEN
    RAISE EXCEPTION 'RB_RACE_NOT_DELETABLE: course en cours avec des paris, annulez-la d''abord' USING ERRCODE = 'P0001';
  END IF;
  IF n_partner_pending > 0 THEN
    RAISE EXCEPTION 'RB_RACE_NOT_DELETABLE: des parts d''associés restent à verser sur cette course' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('racebet.maintenance', 'on', true);
  DELETE FROM partner_payouts WHERE race_id = p_race;
  DELETE FROM settlements WHERE race_id = p_race;
  DELETE FROM race_results WHERE race_id = p_race;
  DELETE FROM race_closures WHERE race_id = p_race;
  DELETE FROM bets WHERE race_id = p_race;
  DELETE FROM drivers WHERE race_id = p_race;
  DELETE FROM races WHERE id = p_race;
  PERFORM set_config('racebet.maintenance', 'off', true);
END;
$$;
