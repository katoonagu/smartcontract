import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "./repository";
import {
  createPostgresUnifiedRequestStore,
  type CheckRequestRecord
} from "./requestService";

const GENERATION_FENCE_LOCK_ID = "781981234778193";

export type ActiveCheckGeneration =
  | {
      readonly deliveryGeneration: "legacy";
      readonly generationId: null;
      readonly activatedAt: null;
      readonly runtimeCommit: null;
    }
  | {
      readonly deliveryGeneration: "unified";
      readonly generationId: string;
      readonly activatedAt: string;
      readonly runtimeCommit: string;
    };

function iso(value: unknown): string {
  const parsed = new Date(String(value));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== String(value)
  ) {
    throw new TypeError("unified_generation_invalid_timestamp");
  }
  return parsed.toISOString();
}

function unifiedGeneration(row: Record<string, unknown>): ActiveCheckGeneration {
  if (
    row.delivery_generation !== "unified" ||
    typeof row.generation_id !== "string" ||
    !row.generation_id ||
    typeof row.runtime_commit !== "string" ||
    !row.runtime_commit
  ) {
    throw new Error("unified_generation_fence_malformed");
  }
  return {
    deliveryGeneration: "unified",
    generationId: row.generation_id,
    activatedAt: new Date(String(row.activated_at)).toISOString(),
    runtimeCommit: row.runtime_commit
  };
}

export async function getActiveCheckGeneration(
  db: UnifiedQueryable
): Promise<ActiveCheckGeneration> {
  const row = (
    await db.query(
      `select generation_id, activated_at, runtime_commit, delivery_generation
         from unified_check_generation_fence
        where active = true
        order by activated_at desc, generation_id
        limit 1`
    )
  ).rows[0];
  return row
    ? unifiedGeneration(row)
    : {
        deliveryGeneration: "legacy",
        generationId: null,
        activatedAt: null,
        runtimeCommit: null
      };
}

export function ownsWalletDelivery(
  generation: ActiveCheckGeneration,
  candidate: "legacy"
): generation is Extract<
  ActiveCheckGeneration,
  { deliveryGeneration: "legacy" }
>;
export function ownsWalletDelivery(
  generation: ActiveCheckGeneration,
  candidate: "unified"
): generation is Extract<
  ActiveCheckGeneration,
  { deliveryGeneration: "unified" }
>;
export function ownsWalletDelivery(
  generation: ActiveCheckGeneration,
  candidate: "legacy" | "unified"
): boolean {
  return generation.deliveryGeneration === candidate;
}

export function selectUnifiedStartupSchedule<T>(
  generation: ActiveCheckGeneration,
  schedule: readonly T[]
): T[] {
  return ownsWalletDelivery(generation, "unified")
    ? [...schedule]
    : [];
}

export async function activateUnifiedGeneration(
  db: UnifiedTransactionalQueryable,
  input: {
    generationId: string;
    activatedAt: string;
    runtimeCommit: string;
  }
): Promise<ActiveCheckGeneration> {
  if (!input.generationId.trim()) {
    throw new TypeError("unified_generation_id_required");
  }
  if (!input.runtimeCommit.trim()) {
    throw new TypeError("unified_generation_runtime_commit_required");
  }
  const activatedAt = iso(input.activatedAt);
  return db.transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [
      GENERATION_FENCE_LOCK_ID
    ]);
    const active = await getActiveCheckGeneration(client);
    if (active.deliveryGeneration === "unified") {
      if (
        active.generationId === input.generationId &&
        active.activatedAt === activatedAt &&
        active.runtimeCommit === input.runtimeCommit
      ) {
        return active;
      }
      throw new Error("unified_generation_already_active");
    }
    const inFlightLegacyClaims = (
      await client.query(
        `select id
           from forensic_check_jobs
          where kind in ('where_is_money_check','address_deep_check')
            and progress_json#>>'{telegramDelivery,state,status}' = 'retryable'
            and progress_json#>'{telegramDelivery,claim}' <> 'null'::jsonb
          order by id
          for update`
      )
    ).rows;
    if (inFlightLegacyClaims.length > 0) {
      throw new Error(
        `legacy_delivery_claims_in_flight:${inFlightLegacyClaims
          .map((row) => String(row.id))
          .join(",")}`
      );
    }
    const row = (
      await client.query(
        `insert into unified_check_generation_fence (
          generation_id, activated_at, runtime_commit, delivery_generation, active
        ) values ($1,$2,$3,'unified',true)
        returning generation_id, activated_at, runtime_commit, delivery_generation`,
        [input.generationId, activatedAt, input.runtimeCommit]
      )
    ).rows[0];
    if (!row) throw new Error("unified_generation_activation_failed");
    return unifiedGeneration(row);
  });
}

export async function quarantineLegacyWalletDeliveries(
  db: UnifiedQueryable,
  input: {
    subjectAddress: string;
    chatId: string;
    generationId: string;
    quarantinedAt: string;
  }
): Promise<{ quarantinedJobIds: string[] }> {
  const quarantinedAt = iso(input.quarantinedAt);
  const result = await db.query(
    `update forensic_check_jobs
        set progress_json = (progress_json - 'telegramDelivery')
          || jsonb_build_object(
            'quarantinedLegacyTelegramDelivery', progress_json->'telegramDelivery',
            'legacyDeliveryFence', jsonb_build_object(
              'version', 'legacy-wallet-delivery-fence-v1',
              'generationId', $3::text,
              'quarantinedAt', $4::text
            )
          ),
            updated_at = now()
      where subject_address = $1
        and chat_id = $2
        and kind in ('where_is_money_check','address_deep_check')
        and progress_json#>>'{telegramDelivery,state,status}'
          in ('pending','retryable')
        and progress_json#>'{telegramDelivery,claim}' = 'null'::jsonb
      returning id`,
    [
      input.subjectAddress,
      input.chatId,
      input.generationId,
      quarantinedAt
    ]
  );
  return {
    quarantinedJobIds: result.rows.map((row) => String(row.id))
  };
}

export async function handoffWalletDeliveryToUnified(
  db: UnifiedTransactionalQueryable,
  input: {
    subjectAddress: string;
    chatId: string;
    generationId: string;
    acquiredAt: string;
  }
): Promise<{ quarantinedJobIds: string[] }> {
  const acquiredAt = iso(input.acquiredAt);
  return db.transaction(async (client) => {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [`${input.subjectAddress}:${input.chatId}`]
    );
    const active = await getActiveCheckGeneration(client);
    if (
      active.deliveryGeneration !== "unified" ||
      active.generationId !== input.generationId
    ) {
      throw new Error("unified_wallet_handoff_generation_mismatch");
    }
    const lockedJobs = (
      await client.query(
        `select id, progress_json#>'{telegramDelivery,claim}' as claim
           from forensic_check_jobs
          where subject_address = $1
            and chat_id = $2
            and kind in ('where_is_money_check','address_deep_check')
          order by id
          for update`,
        [input.subjectAddress, input.chatId]
      )
    ).rows;
    const inFlight = lockedJobs.filter((row) =>
      row.claim !== null && row.claim !== undefined
    );
    if (inFlight.length > 0) {
      throw new Error(
        `legacy_wallet_delivery_claim_in_flight:${inFlight
          .map((row) => String(row.id))
          .join(",")}`
      );
    }
    const inserted = (
      await client.query(
        `insert into unified_wallet_delivery_ownership (
          subject_address, chat_id, generation_id, acquired_at
        ) values ($1,$2,$3,$4)
        on conflict (subject_address, chat_id) do nothing
        returning generation_id`,
        [
          input.subjectAddress,
          input.chatId,
          input.generationId,
          acquiredAt
        ]
      )
    ).rows[0];
    if (!inserted) {
      const existing = (
        await client.query(
          `select generation_id
             from unified_wallet_delivery_ownership
            where subject_address = $1 and chat_id = $2`,
          [input.subjectAddress, input.chatId]
        )
      ).rows[0];
      if (String(existing?.generation_id) !== input.generationId) {
        throw new Error("unified_wallet_handoff_owner_conflict");
      }
    }
    return quarantineLegacyWalletDeliveries(client, {
      subjectAddress: input.subjectAddress,
      chatId: input.chatId,
      generationId: input.generationId,
      quarantinedAt: acquiredAt
    });
  });
}

export async function handoffWalletDeliveryAndAcceptRequest(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly subjectAddress: string;
    readonly chatId: string;
    readonly generationId: string;
    readonly acquiredAt: string;
    readonly request: CheckRequestRecord;
  }
): Promise<{
  readonly quarantinedJobIds: string[];
  readonly request: CheckRequestRecord;
}> {
  return db.transaction(async (client) => {
    const transactionHost: UnifiedTransactionalQueryable = {
      query: (sql, values) => client.query(sql, values),
      transaction: (work) => work(client)
    };
    const handoff = await handoffWalletDeliveryToUnified(transactionHost, {
      subjectAddress: input.subjectAddress,
      chatId: input.chatId,
      generationId: input.generationId,
      acquiredAt: input.acquiredAt
    });
    const accepted = await createPostgresUnifiedRequestStore(
      transactionHost
    ).createOrGetAcceptedRequest(input.request);
    if (
      accepted.requestCorrelationId !== input.request.requestCorrelationId ||
      accepted.subjectAddress !== input.request.subjectAddress ||
      accepted.chatId !== input.request.chatId ||
      accepted.messageThreadId !== input.request.messageThreadId ||
      accepted.locale !== input.request.locale ||
      accepted.runPurpose !== input.request.runPurpose ||
      accepted.sideEffectPolicy !== input.request.sideEffectPolicy
    ) {
      throw new Error("unified_request_correlation_conflict");
    }
    return {
      quarantinedJobIds: handoff.quarantinedJobIds,
      request: accepted
    };
  });
}
