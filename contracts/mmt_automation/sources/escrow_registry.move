/// MMT Position Auto-Close Escrow Registry
///
/// This module provides escrow functionality for MMT CLMM positions.
/// Users deposit positions into escrow with a timer. When the timer expires,
/// an authorized executor (backend service) can withdraw the position to
/// execute the close operation and return proceeds to the original owner.
///
/// Flow:
/// 1. User calls `deposit_position` with their position NFT and expiry time
/// 2. Position is stored in a shared PositionEscrow object
/// 3. When timer expires, backend calls `withdraw_for_close`
/// 4. Backend executes MMT close (removeLiquidity, collectFee, etc.)
/// 5. Proceeds are sent to the original owner stored in escrow
/// 6. User can cancel before timer expires via `cancel_escrow`
module mmt_automation::escrow_registry {
    use sui::clock::{Self, Clock};
    use sui::dynamic_object_field as dof;
    use sui::event;

    // ============ Error Codes ============
    const E_NOT_ADMIN: u64 = 1;
    const E_NOT_OWNER: u64 = 2;
    const E_NOT_EXPIRED: u64 = 3;
    const E_ALREADY_EXPIRED: u64 = 4;
    const E_POSITION_NOT_FOUND: u64 = 5;
    const E_INVALID_EXPIRY: u64 = 6;

    // ============ Structs ============

    /// Global registry that tracks admin and configuration
    public struct EscrowRegistry has key {
        id: UID,
        /// Admin address that can execute closes
        admin: address,
        /// Total positions currently in escrow
        total_escrows: u64,
        /// Total positions that have been closed
        total_closed: u64,
    }

    /// Individual escrow for a position
    /// The position itself is stored as a dynamic object field
    public struct PositionEscrow has key {
        id: UID,
        /// Original owner who deposited the position
        original_owner: address,
        /// Pool ID for the position (needed for close operation)
        pool_id: address,
        /// Unix timestamp (milliseconds) when position can be closed
        expires_at: u64,
        /// Whether this escrow has been executed
        executed: bool,
    }

    /// Capability to prove admin rights (held by deployer)
    public struct AdminCap has key, store {
        id: UID,
    }

    // ============ Events ============

    public struct PositionDeposited has copy, drop {
        escrow_id: address,
        position_id: address,
        original_owner: address,
        pool_id: address,
        expires_at: u64,
    }

    public struct PositionWithdrawn has copy, drop {
        escrow_id: address,
        position_id: address,
        original_owner: address,
        executor: address,
    }

    public struct EscrowCancelled has copy, drop {
        escrow_id: address,
        position_id: address,
        original_owner: address,
    }

    public struct AdminChanged has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    // ============ Init ============

    /// Initialize the escrow registry
    fun init(ctx: &mut TxContext) {
        let sender = ctx.sender();

        // Create and share the registry
        let registry = EscrowRegistry {
            id: object::new(ctx),
            admin: sender,
            total_escrows: 0,
            total_closed: 0,
        };
        transfer::share_object(registry);

        // Give admin capability to deployer
        let admin_cap = AdminCap {
            id: object::new(ctx),
        };
        transfer::transfer(admin_cap, sender);
    }

    // ============ User Functions ============

    /// Deposit a position into escrow for auto-close
    ///
    /// # Arguments
    /// * `position` - The position NFT to deposit (any type that is key + store)
    /// * `pool_id` - The pool address (for close operation reference)
    /// * `expires_at` - Unix timestamp in milliseconds when close can be executed
    /// * `clock` - The Sui clock object for time validation
    public entry fun deposit_position<T: key + store>(
        registry: &mut EscrowRegistry,
        position: T,
        pool_id: address,
        expires_at: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let current_time = clock::timestamp_ms(clock);
        assert!(expires_at > current_time, E_INVALID_EXPIRY);

        let sender = ctx.sender();
        let position_id = object::id_address(&position);

        // Create escrow object
        let mut escrow = PositionEscrow {
            id: object::new(ctx),
            original_owner: sender,
            pool_id,
            expires_at,
            executed: false,
        };

        let escrow_id = object::id_address(&escrow);

        // Store position as dynamic object field
        dof::add(&mut escrow.id, b"position", position);

        // Share the escrow object
        transfer::share_object(escrow);

        // Update registry stats
        registry.total_escrows = registry.total_escrows + 1;

        // Emit event
        event::emit(PositionDeposited {
            escrow_id,
            position_id,
            original_owner: sender,
            pool_id,
            expires_at,
        });
    }

    /// Cancel an escrow and get position back (only before timer expires)
    ///
    /// # Arguments
    /// * `escrow` - The escrow to cancel
    /// * `clock` - The Sui clock for time validation
    public fun cancel_escrow<T: key + store>(
        registry: &mut EscrowRegistry,
        escrow: PositionEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ): T {
        let sender = ctx.sender();
        assert!(sender == escrow.original_owner, E_NOT_OWNER);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < escrow.expires_at, E_ALREADY_EXPIRED);

        let PositionEscrow {
            mut id,
            original_owner,
            pool_id: _,
            expires_at: _,
            executed: _
        } = escrow;

        // Extract position
        let position: T = dof::remove(&mut id, b"position");
        let position_id = object::id_address(&position);
        let escrow_id = object::uid_to_address(&id);

        // Delete escrow UID
        object::delete(id);

        // Update registry stats
        registry.total_escrows = registry.total_escrows - 1;

        // Emit event
        event::emit(EscrowCancelled {
            escrow_id,
            position_id,
            original_owner,
        });

        position
    }

    /// Cancel escrow and transfer position back to owner (entry function wrapper)
    public entry fun cancel_escrow_and_return<T: key + store>(
        registry: &mut EscrowRegistry,
        escrow: PositionEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let position = cancel_escrow<T>(registry, escrow, clock, ctx);
        transfer::public_transfer(position, ctx.sender());
    }

    // ============ Admin/Executor Functions ============

    /// Withdraw position for close execution (only after timer expires)
    /// This returns the position to be used in subsequent PTB instructions
    ///
    /// # Arguments
    /// * `_admin_cap` - Proof of admin rights
    /// * `escrow` - The escrow to execute
    /// * `clock` - The Sui clock for time validation
    public fun withdraw_for_close<T: key + store>(
        _admin_cap: &AdminCap,
        registry: &mut EscrowRegistry,
        escrow: PositionEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ): (T, address) {
        let current_time = clock::timestamp_ms(clock);
        assert!(current_time >= escrow.expires_at, E_NOT_EXPIRED);

        let PositionEscrow {
            mut id,
            original_owner,
            pool_id: _,
            expires_at: _,
            executed: _
        } = escrow;

        // Extract position
        let position: T = dof::remove(&mut id, b"position");
        let position_id = object::id_address(&position);
        let escrow_id = object::uid_to_address(&id);
        let executor = ctx.sender();

        // Delete escrow UID
        object::delete(id);

        // Update registry stats
        registry.total_escrows = registry.total_escrows - 1;
        registry.total_closed = registry.total_closed + 1;

        // Emit event
        event::emit(PositionWithdrawn {
            escrow_id,
            position_id,
            original_owner,
            executor,
        });

        (position, original_owner)
    }

    /// Change the admin address
    public entry fun change_admin(
        _admin_cap: &AdminCap,
        registry: &mut EscrowRegistry,
        new_admin: address,
    ) {
        let old_admin = registry.admin;
        registry.admin = new_admin;

        event::emit(AdminChanged {
            old_admin,
            new_admin,
        });
    }

    /// Transfer admin capability to new address
    public entry fun transfer_admin_cap(
        admin_cap: AdminCap,
        new_admin: address,
    ) {
        transfer::transfer(admin_cap, new_admin);
    }

    // ============ View Functions ============

    /// Get escrow details
    public fun get_escrow_info(escrow: &PositionEscrow): (address, address, u64, bool) {
        (escrow.original_owner, escrow.pool_id, escrow.expires_at, escrow.executed)
    }

    /// Check if escrow has expired
    public fun is_expired(escrow: &PositionEscrow, clock: &Clock): bool {
        clock::timestamp_ms(clock) >= escrow.expires_at
    }

    /// Get time remaining until expiry (returns 0 if expired)
    public fun time_remaining(escrow: &PositionEscrow, clock: &Clock): u64 {
        let current = clock::timestamp_ms(clock);
        if (current >= escrow.expires_at) {
            0
        } else {
            escrow.expires_at - current
        }
    }

    /// Get registry stats
    public fun get_registry_stats(registry: &EscrowRegistry): (address, u64, u64) {
        (registry.admin, registry.total_escrows, registry.total_closed)
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
