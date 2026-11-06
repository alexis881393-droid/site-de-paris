-- =====================================================================
-- RACEBET CONTROL — règles d'intégrité appliquées DIRECTEMENT en base.
-- Elles protègent les données même en cas d'appel direct à l'API ou à SQL.
--
-- Contournement : uniquement si la variable de session
-- racebet.maintenance = 'on' (positionnée exclusivement par le script
-- local de restauration, jamais par l'application web).
-- =====================================================================

CREATE OR REPLACE FUNCTION racebet_maintenance() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('racebet.maintenance', true), '') = 'on'
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- PARIS : immuables après insertion, insertion seulement si paris ouverts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_bets_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF racebet_maintenance() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'RB_BET_IMMUTABLE: un pari validé ne peut être ni modifié ni supprimé'
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bets_no_update_delete
  BEFORE UPDATE OR DELETE ON bets
  FOR EACH ROW EXECUTE FUNCTION racebet_bets_immutable();
--> statement-breakpoint
CREATE TRIGGER bets_no_truncate
  BEFORE TRUNCATE ON bets
  FOR EACH STATEMENT EXECUTE FUNCTION racebet_bets_immutable();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION racebet_bets_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF racebet_maintenance() THEN
    RETURN NEW;
  END IF;
  -- Verrou partagé : une clôture concurrente (FOR UPDATE) attend la fin de ce pari,
  -- ou ce pari attend la clôture puis est rejeté.
  SELECT status INTO s FROM races WHERE id = NEW.race_id FOR SHARE;
  IF s IS NULL THEN
    RAISE EXCEPTION 'RB_RACE_NOT_FOUND: course introuvable' USING ERRCODE = 'P0001';
  END IF;
  IF s <> 'open' THEN
    RAISE EXCEPTION 'RB_BETS_NOT_OPEN: les paris ne sont pas ouverts pour cette course' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bets_insert_guard
  BEFORE INSERT ON bets
  FOR EACH ROW EXECUTE FUNCTION racebet_bets_insert_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- PILOTES : modifiables uniquement en préparation ; seul le classement
-- peut être renseigné après la clôture (enregistrement du résultat).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_drivers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF racebet_maintenance() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO s FROM races WHERE id = NEW.race_id FOR SHARE;
    IF s IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'RB_DRIVERS_LOCKED: la liste des pilotes est verrouillée' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.is_winner OR NEW.final_position IS NOT NULL THEN
      RAISE EXCEPTION 'RB_DRIVERS_LOCKED: résultat non autorisé à la création' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO s FROM races WHERE id = OLD.race_id;
    -- Course déjà supprimée (suppression en cascade d'une course sans paris) : autorisé.
    IF s IS NULL OR s = 'draft' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'RB_DRIVERS_LOCKED: la liste des pilotes est verrouillée' USING ERRCODE = 'P0001';
  END IF;

  -- UPDATE
  SELECT status INTO s FROM races WHERE id = OLD.race_id FOR SHARE;
  IF NEW.id <> OLD.id OR NEW.race_id <> OLD.race_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'RB_DRIVERS_LOCKED: identifiants de pilote immuables' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.name, NEW.name_key, NEW.number) IS DISTINCT FROM (OLD.name, OLD.name_key, OLD.number)
     AND s <> 'draft' THEN
    RAISE EXCEPTION 'RB_DRIVERS_LOCKED: la liste des pilotes est verrouillée' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.final_position, NEW.is_winner) IS DISTINCT FROM (OLD.final_position, OLD.is_winner)
     AND s <> 'closed' THEN
    RAISE EXCEPTION 'RB_RESULT_LOCKED: le classement ne peut être saisi qu''une fois, après la clôture' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER drivers_guard
  BEFORE INSERT OR UPDATE OR DELETE ON drivers
  FOR EACH ROW EXECUTE FUNCTION racebet_drivers_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- COURSES : commission figée, transitions de statut contrôlées
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_races_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF racebet_maintenance() THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'RB_RACE_IMMUTABLE: identifiant de course immuable' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.commission_bps <> OLD.commission_bps THEN
    RAISE EXCEPTION 'RB_COMMISSION_LOCKED: la commission est définitive' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft'     AND NEW.status IN ('open', 'cancelled'))
    OR (OLD.status = 'open'      AND NEW.status IN ('closed', 'cancelled'))
    OR (OLD.status = 'closed'    AND NEW.status IN ('result', 'paid', 'cancelled'))
    OR (OLD.status = 'result'    AND NEW.status = 'paid')
    OR (OLD.status = 'cancelled' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'RB_INVALID_TRANSITION: transition % -> % interdite', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER races_guard
  BEFORE UPDATE ON races
  FOR EACH ROW EXECUTE FUNCTION racebet_races_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- RÈGLEMENTS : seul le passage "pending" -> "paid" est possible, une fois.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_settlements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF racebet_maintenance() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RB_SETTLEMENT_IMMUTABLE: un règlement ne peut pas être supprimé' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW.race_id, NEW.bet_id, NEW.kind, NEW.amount_due, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.race_id, OLD.bet_id, OLD.kind, OLD.amount_due, OLD.created_at) THEN
    RAISE EXCEPTION 'RB_SETTLEMENT_IMMUTABLE: montant et nature du règlement immuables' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'RB_ALREADY_PAID: règlement déjà effectué' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlements_guard
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION racebet_settlements_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Instantanés de clôture / résultats et journal : append-only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION racebet_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF racebet_maintenance() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'RB_APPEND_ONLY: % est en lecture seule après écriture', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER race_closures_append_only
  BEFORE UPDATE OR DELETE ON race_closures
  FOR EACH ROW EXECUTE FUNCTION racebet_append_only();
--> statement-breakpoint
CREATE TRIGGER race_results_append_only
  BEFORE UPDATE OR DELETE ON race_results
  FOR EACH ROW EXECUTE FUNCTION racebet_append_only();
--> statement-breakpoint
CREATE TRIGGER operation_log_append_only
  BEFORE UPDATE OR DELETE ON operation_log
  FOR EACH ROW EXECUTE FUNCTION racebet_append_only();
