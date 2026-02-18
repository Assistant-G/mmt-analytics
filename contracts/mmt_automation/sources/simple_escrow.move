/// Simple Position Escrow
///
/// A simpler escrow module that uses address-based authorization
/// instead of capability tokens. Easier for backend integration.
///
/// The escrow stores:
/// - Position NFT (via dynamic object field)
/// - Original owner address
/// - Executor address (who can close after timer)
/// - Expiry timestamp
///
/// Flow:
/// 1. User creates escrow with position, specifying executor and expiry
/// 2. After expiry, executor calls `execute_and_close`
/// 3. Position is released and escrow is cleaned up
/// 4. User can cancel before expiry
module mmt_automation::simple_escrow {
    use sui::clock::{Self, Clock};
    use sui::dynamic_object_field as dof;
    use sui::event;

    // ============ Error Codes ============
    const E_NOT_EXECUTOR: u64 = 1;
    const E_NOT_OWNER: u64 = 2;
    const E_NOT_EXPIRED: u64 = 3;
    const E_ALREADY_EXPIRED: u64 = 4;
    const E_INVALID_EXPIRY: u64 = 5;

    // ============ Structs ============

    /// Configuration object (shared) - stores the authorized executor
    public struct EscrowConfig has key {
        id: UID,
        /// Address authorized to execute closes
        executor: address,
        /// Admin who can update config
        admin: address,
        /// Stats
        total_created: u64,
        total_executed: u64,
        total_cancelled: u64,
    }

    /// Individual escrow holding a position
    public struct SimpleEscrow has key {
        id: UID,
        /// Original owner of the position
        owner: address,
        /// Pool ID (for reference)
        pool_id: address,
        /// When the position can be closed (Unix ms)
        expires_at: u64,
        /// Whether to automatically reopen position after close
        auto_reopen: bool,
        /// Reopen parameters (if auto_reopen is true)
        reopen_range_percent: u64,
        /// Number of repeats remaining (0 = no more repeats)
        remaining_repeats: u64,
    }

    // ============ Events ============

    public struct EscrowCreated has copy, drop {
        escrow_id: address,
        position_id: address,
        owner: address,
        pool_id: address,
        expires_at: u64,
        auto_reopen: bool,
    }

    public struct EscrowExecuted has copy, drop {
        escrow_id: address,
        position_id: address,
        owner: address,
        executor: address,
    }

    public struct EscrowCancelled has copy, drop {
        escrow_id: address,
        position_id: address,
        owner: address,
    }

    public struct ConfigUpdated has copy, drop {
        old_executor: address,
        new_executor: address,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let sender = ctx.sender();

        let config = EscrowConfig {
            id: object::new(ctx),
            executor: sender,
            admin: sender,
            total_created: 0,
            total_executed: 0,
            total_cancelled: 0,
        };

        transfer::share_object(config);
    }

    // ============ User Functions ============

    /// Create an escrow for a position
    ///
    /// # Arguments
    /// * `position` - The position NFT to escrow
    /// * `pool_id` - Pool address for reference
    /// * `expires_at` - Unix timestamp (ms) when close can be executed
    /// * `auto_reopen` - Whether to reopen position after close
    /// * `reopen_range_percent` - Price range % for reopening (e.g., 500 = 5%)
    /// * `remaining_repeats` - Number of times to repeat (0 = once only)
    /// * `clock` - Sui clock for time validation
    public entry fun create_escrow<T: key + store>(
        config: &mut EscrowConfig,
        position: T,
        pool_id: address,
        expires_at: u64,
        auto_reopen: bool,
        reopen_range_percent: u64,
        remaining_repeats: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let current_time = clock::timestamp_ms(clock);
        assert!(expires_at > current_time, E_INVALID_EXPIRY);

        let sender = ctx.sender();
        let position_id = object::id_address(&position);

        let mut escrow = SimpleEscrow {
            id: object::new(ctx),
            owner: sender,
            pool_id,
            expires_at,
            auto_reopen,
            reopen_range_percent,
            remaining_repeats,
        };

        let escrow_id = object::id_address(&escrow);

        // Store position
        dof::add(&mut escrow.id, b"position", position);

        transfer::share_object(escrow);

        config.total_created = config.total_created + 1;

        event::emit(EscrowCreated {
            escrow_id,
            position_id,
            owner: sender,
            pool_id,
            expires_at,
            auto_reopen,
        });
    }

    /// Cancel escrow and return position (only owner, only before expiry)
    public fun cancel<T: key + store>(
        config: &mut EscrowConfig,
        escrow: SimpleEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ): T {
        let sender = ctx.sender();
        assert!(sender == escrow.owner, E_NOT_OWNER);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < escrow.expires_at, E_ALREADY_EXPIRED);

        let SimpleEscrow {
            mut id,
            owner,
            pool_id: _,
            expires_at: _,
            auto_reopen: _,
            reopen_range_percent: _,
            remaining_repeats: _,
        } = escrow;

        let position: T = dof::remove(&mut id, b"position");
        let position_id = object::id_address(&position);
        let escrow_id = object::uid_to_address(&id);

        object::delete(id);

        config.total_cancelled = config.total_cancelled + 1;

        event::emit(EscrowCancelled {
            escrow_id,
            position_id,
            owner,
        });

        position
    }

    /// Cancel and transfer position back to owner
    public entry fun cancel_and_return<T: key + store>(
        config: &mut EscrowConfig,
        escrow: SimpleEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let owner = escrow.owner;
        let position = cancel<T>(config, escrow, clock, ctx);
        transfer::public_transfer(position, owner);
    }

    // ============ Executor Functions ============

    /// Execute close - withdraws position after timer expires
    /// Returns position and owner address for subsequent operations
    ///
    /// # Arguments
    /// * `config` - The escrow configuration (checks executor authorization)
    /// * `escrow` - The escrow to execute
    /// * `clock` - Sui clock for time validation
    ///
    /// # Returns
    /// * Position object
    /// * Original owner address (for sending proceeds)
    public fun execute<T: key + store>(
        config: &mut EscrowConfig,
        escrow: SimpleEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ): (T, address) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time >= escrow.expires_at, E_NOT_EXPIRED);

        let SimpleEscrow {
            mut id,
            owner,
            pool_id: _,
            expires_at: _,
            auto_reopen: _,
            reopen_range_percent: _,
            remaining_repeats: _,
        } = escrow;

        let position: T = dof::remove(&mut id, b"position");
        let position_id = object::id_address(&position);
        let escrow_id = object::uid_to_address(&id);

        object::delete(id);

        config.total_executed = config.total_executed + 1;

        event::emit(EscrowExecuted {
            escrow_id,
            position_id,
            owner,
            executor: sender,
        });

        (position, owner)
    }

    // ============ Admin Functions ============

    /// Update the executor address
    public entry fun set_executor(
        config: &mut EscrowConfig,
        new_executor: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.admin, E_NOT_OWNER);

        let old_executor = config.executor;
        config.executor = new_executor;

        event::emit(ConfigUpdated {
            old_executor,
            new_executor,
        });
    }

    /// Transfer admin rights
    public entry fun transfer_admin(
        config: &mut EscrowConfig,
        new_admin: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.admin, E_NOT_OWNER);
        config.admin = new_admin;
    }

    // ============ View Functions ============

    /// Get escrow details
    public fun get_escrow_info(escrow: &SimpleEscrow): (address, address, u64, bool, u64, u64) {
        (
            escrow.owner,
            escrow.pool_id,
            escrow.expires_at,
            escrow.auto_reopen,
            escrow.reopen_range_percent,
            escrow.remaining_repeats
        )
    }

    /// Check if expired
    public fun is_expired(escrow: &SimpleEscrow, clock: &Clock): bool {
        clock::timestamp_ms(clock) >= escrow.expires_at
    }

    /// Get time remaining
    public fun time_remaining(escrow: &SimpleEscrow, clock: &Clock): u64 {
        let current = clock::timestamp_ms(clock);
        if (current >= escrow.expires_at) {
            0
        } else {
            escrow.expires_at - current
        }
    }

    /// Get owner
    public fun owner(escrow: &SimpleEscrow): address {
        escrow.owner
    }

    /// Get pool ID
    public fun pool_id(escrow: &SimpleEscrow): address {
        escrow.pool_id
    }

    /// Get config stats
    public fun get_config_stats(config: &EscrowConfig): (address, address, u64, u64, u64) {
        (
            config.executor,
            config.admin,
            config.total_created,
            config.total_executed,
            config.total_cancelled
        )
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
