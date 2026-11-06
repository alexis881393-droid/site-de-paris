CREATE TABLE "driver_registry_hidden" (
	"name_key" text PRIMARY KEY NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bets" DROP CONSTRAINT "bets_identity_prefix";--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_identity_prefix" CHECK ("bets"."identity_key" ~ '^(fivem|tel|name):.+');
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Suppression définitive d'une course et de toutes ses données.
-- Autorisée uniquement si aucune somme n'est encore due :
--   * jamais pour "result" (gains en attente de paiement) ;
--   * jamais pour "cancelled" avec des remboursements en attente ;
--   * jamais pour "open" / "closed" contenant des paris (annuler d'abord).
-- Les garde-fous d'immuabilité sont levés pour CETTE transaction seulement.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_purge_race(p_race uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s text;
  n_bets int;
  n_pending int;
BEGIN
  SELECT status INTO s FROM races WHERE id = p_race FOR UPDATE;
  IF s IS NULL THEN
    RAISE EXCEPTION 'RB_RACE_NOT_FOUND: course introuvable' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n_bets FROM bets WHERE race_id = p_race;
  SELECT count(*) INTO n_pending FROM settlements WHERE race_id = p_race AND status = 'pending';
  IF s = 'result' OR n_pending > 0 THEN
    RAISE EXCEPTION 'RB_RACE_NOT_DELETABLE: des paiements ou remboursements sont encore dus sur cette course' USING ERRCODE = 'P0001';
  END IF;
  IF s IN ('open', 'closed') AND n_bets > 0 THEN
    RAISE EXCEPTION 'RB_RACE_NOT_DELETABLE: course en cours avec des paris, annulez-la d''abord' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('racebet.maintenance', 'on', true);
  DELETE FROM settlements WHERE race_id = p_race;
  DELETE FROM race_results WHERE race_id = p_race;
  DELETE FROM race_closures WHERE race_id = p_race;
  DELETE FROM bets WHERE race_id = p_race;
  DELETE FROM drivers WHERE race_id = p_race;
  DELETE FROM races WHERE id = p_race;
  PERFORM set_config('racebet.maintenance', 'off', true);
END;
$$;
