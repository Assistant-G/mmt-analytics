/// LP Registry - Automated Position Management
///
/// This module provides a registry for LP positions with automated features:
/// - Auto-rebalance: Automatically rebalance when price goes out of range
/// - Rebalance delay: Wait X seconds before rebalancing (price may return)
/// - Auto-compound: Reinvest trading fees into position liquidity
/// - Recurring: Repeat cycles indefinitely or for specified count
/// - Pause/Resume: Temporarily pause automation
/// - Exit: Withdraw position at any time
///
/// Position is stored in the registry (hidden from portfolio trackers).
/// Only registered operators can perform automated operations.
///
/// Flow:
/// 1. User calls `register_position` with their position and settings
/// 2. Backend monitors positions and executes auto-rebalance/compound
/// 3. User can pause, resume, update settings, or exit at any time
module mmt_automation::lp_registry {
    use sui::clock::{Self, Clock};
    use sui::dynamic_object_field as dof;
    use sui::event;
    use sui::vec_set::{Self, VecSet};

    // ============ Error Codes ============
    const E_NOT_ADMIN: u64 = 1;
    const E_NOT_OWNER: u64 = 2;
    const E_NOT_OPERATOR: u64 = 3;
    const E_POSITION_PAUSED: u64 = 4;
    const E_POSITION_NOT_PAUSED: u64 = 5;
    const E_INVALID_DELAY: u64 = 6;
    const E_POSITION_IN_USE: u64 = 7;
    const E_POSITION_NOT_IN_USE: u64 = 8;
    const E_DELAY_NOT_EXPIRED: u64 = 9;
    const E_NO_REBALANCE_PENDING: u64 = 10;

    // ============ Constants ============
    /// Maximum rebalance delay: 24 hours in milliseconds
    const MAX_REBALANCE_DELAY_MS: u64 = 86_400_000;
    /// Minimum rebalance delay: 0 (immediate)
    const MIN_REBALANCE_DELAY_MS: u64 = 0;

    // ============ Structs ============

    /// Global registry configuration (shared object)
    public struct LPRegistry has key {
        id: UID,
        /// Admin address
        admin: address,
        /// Authorized operators who can execute automation
        operators: VecSet<address>,
        /// Stats
        total_registered: u64,
        total_rebalanced: u64,
        total_compounded: u64,
        total_exited: u64,
    }

    /// Registered position with automation settings
    public struct RegisteredPosition has key {
        id: UID,
        /// Owner who registered the position
        owner: address,
        /// Pool ID for the position
        pool_id: address,

        // === Feature Toggles ===
        /// Enable auto-rebalance when out of range
        auto_rebalance: bool,
        /// Enable auto-compound of fees
        auto_compound: bool,
        /// Enable recurring operations (0 = infinite, N = N times remaining)
        recurring_count: u64,

        // === Rebalance Settings ===
        /// Delay before rebalancing (ms) - wait for price to return
        rebalance_delay_ms: u64,
        /// Range percentage for new position (basis points, e.g., 500 = 5%)
        range_percent_bps: u64,
        /// Use ZAP mode - swap excess tokens to use ALL liquidity in new position
        use_zap: bool,

        // === State ===
        /// Is position currently paused
        is_paused: bool,
        /// Is position currently held by operator (during rebalance)
        is_position_held: bool,
        /// Timestamp when position went out of range (for delay)
        out_of_range_since: u64,
        /// Is there a pending rebalance waiting for delay
        rebalance_pending: bool,

        // === Stats ===
        /// Total rebalances performed
        rebalance_count: u64,
        /// Total compounds performed
        compound_count: u64,
        /// Registration timestamp
        registered_at: u64,
        /// Last activity timestamp
        last_activity_at: u64,
    }

    // ============ Events ============

    public struct PositionRegistered has copy, drop {
        position_id: address,
        registry_id: address,
        owner: address,
        pool_id: address,
        auto_rebalance: bool,
        auto_compound: bool,
        rebalance_delay_ms: u64,
    }

    public struct PositionRetrieved has copy, drop {
        registry_id: address,
        position_id: address,
        operator: address,
        reason: vector<u8>, // "rebalance", "compound", "claim"
    }

    public struct PositionStored has copy, drop {
        registry_id: address,
        position_id: address,
        operator: address,
    }

    public struct RebalanceRecorded has copy, drop {
        registry_id: address,
        old_position_id: address,
        new_position_id: address,
        owner: address,
        rebalance_count: u64,
    }

    public struct CompoundRecorded has copy, drop {
        registry_id: address,
        position_id: address,
        owner: address,
        compound_count: u64,
    }

    public struct PositionPaused has copy, drop {
        registry_id: address,
        owner: address,
    }

    public struct PositionResumed has copy, drop {
        registry_id: address,
        owner: address,
    }

    public struct PositionExited has copy, drop {
        registry_id: address,
        position_id: address,
        owner: address,
    }

    public struct SettingsUpdated has copy, drop {
        registry_id: address,
        owner: address,
        auto_rebalance: bool,
        auto_compound: bool,
        rebalance_delay_ms: u64,
        range_percent_bps: u64,
        use_zap: bool,
    }

    public struct OutOfRangeDetected has copy, drop {
        registry_id: address,
        position_id: address,
        detected_at: u64,
        rebalance_at: u64, // when rebalance can happen (detected_at + delay)
    }

    public struct RebalanceDelayCleared has copy, drop {
        registry_id: address,
        position_id: address,
        reason: vector<u8>, // "price_returned" or "cancelled"
    }

    public struct OperatorAdded has copy, drop {
        operator: address,
    }

    public struct OperatorRemoved has copy, drop {
        operator: address,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let sender = ctx.sender();

        let mut registry = LPRegistry {
            id: object::new(ctx),
            admin: sender,
            operators: vec_set::empty(),
            total_registered: 0,
            total_rebalanced: 0,
            total_compounded: 0,
            total_exited: 0,
        };

        // Add deployer as first operator
        vec_set::insert(&mut registry.operators, sender);

        transfer::share_object(registry);
    }

    // ============ User Functions ============

    /// Register a position for automated management
    ///
    /// # Arguments
    /// * `position` - The position NFT to register
    /// * `pool_id` - Pool address
    /// * `auto_rebalance` - Enable auto-rebalance
    /// * `auto_compound` - Enable auto-compound of fees
    /// * `recurring_count` - Number of cycles (0 = infinite)
    /// * `rebalance_delay_ms` - Delay before rebalancing (wait for price return)
    /// * `range_percent_bps` - Range width in basis points (500 = 5%)
    public entry fun register_position<T: key + store>(
        registry: &mut LPRegistry,
        position: T,
        pool_id: address,
        auto_rebalance: bool,
        auto_compound: bool,
        recurring_count: u64,
        rebalance_delay_ms: u64,
        range_percent_bps: u64,
        use_zap: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(rebalance_delay_ms <= MAX_REBALANCE_DELAY_MS, E_INVALID_DELAY);

        let sender = ctx.sender();
        let position_id = object::id_address(&position);
        let current_time = clock::timestamp_ms(clock);

        let mut registered = RegisteredPosition {
            id: object::new(ctx),
            owner: sender,
            pool_id,
            auto_rebalance,
            auto_compound,
            recurring_count,
            rebalance_delay_ms,
            range_percent_bps,
            use_zap,
            is_paused: false,
            is_position_held: false,
            out_of_range_since: 0,
            rebalance_pending: false,
            rebalance_count: 0,
            compound_count: 0,
            registered_at: current_time,
            last_activity_at: current_time,
        };

        let registry_id = object::id_address(&registered);

        // Store position as dynamic object field
        dof::add(&mut registered.id, b"position", position);

        transfer::share_object(registered);

        registry.total_registered = registry.total_registered + 1;

        event::emit(PositionRegistered {
            position_id,
            registry_id,
            owner: sender,
            pool_id,
            auto_rebalance,
            auto_compound,
            rebalance_delay_ms,
        });
    }

    /// Update position settings
    public entry fun update_settings(
        registered: &mut RegisteredPosition,
        auto_rebalance: bool,
        auto_compound: bool,
        recurring_count: u64,
        rebalance_delay_ms: u64,
        range_percent_bps: u64,
        use_zap: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registered.owner, E_NOT_OWNER);
        assert!(rebalance_delay_ms <= MAX_REBALANCE_DELAY_MS, E_INVALID_DELAY);

        registered.auto_rebalance = auto_rebalance;
        registered.auto_compound = auto_compound;
        registered.recurring_count = recurring_count;
        registered.rebalance_delay_ms = rebalance_delay_ms;
        registered.range_percent_bps = range_percent_bps;
        registered.use_zap = use_zap;
        registered.last_activity_at = clock::timestamp_ms(clock);

        event::emit(SettingsUpdated {
            registry_id: object::id_address(registered),
            owner: sender,
            auto_rebalance,
            auto_compound,
            rebalance_delay_ms,
            range_percent_bps,
            use_zap,
        });
    }

    /// Pause automation for this position
    public entry fun pause(
        registered: &mut RegisteredPosition,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registered.owner, E_NOT_OWNER);
        assert!(!registered.is_paused, E_POSITION_PAUSED);
        assert!(!registered.is_position_held, E_POSITION_IN_USE);

        registered.is_paused = true;
        registered.last_activity_at = clock::timestamp_ms(clock);
        // Clear any pending rebalance
        registered.rebalance_pending = false;
        registered.out_of_range_since = 0;

        event::emit(PositionPaused {
            registry_id: object::id_address(registered),
            owner: sender,
        });
    }

    /// Resume automation for this position
    public entry fun resume(
        registered: &mut RegisteredPosition,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registered.owner, E_NOT_OWNER);
        assert!(registered.is_paused, E_POSITION_NOT_PAUSED);

        registered.is_paused = false;
        registered.last_activity_at = clock::timestamp_ms(clock);

        event::emit(PositionResumed {
            registry_id: object::id_address(registered),
            owner: sender,
        });
    }

    /// Owner requests immediate rebalance (marks position for rebalance)
    /// This allows the owner to trigger a rebalance even if position is in range
    public entry fun request_rebalance(
        registered: &mut RegisteredPosition,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registered.owner, E_NOT_OWNER);
        assert!(!registered.is_paused, E_POSITION_PAUSED);
        assert!(!registered.is_position_held, E_POSITION_IN_USE);
        assert!(registered.auto_rebalance, E_NOT_OWNER); // auto_rebalance must be enabled

        let current_time = clock::timestamp_ms(clock);

        // Set as pending with current time (minimal delay will be applied)
        registered.out_of_range_since = current_time;
        registered.rebalance_pending = true;
        registered.last_activity_at = current_time;

        let position_id = get_position_id(registered);

        event::emit(OutOfRangeDetected {
            registry_id: object::id_address(registered),
            position_id,
            detected_at: current_time,
            rebalance_at: current_time + registered.rebalance_delay_ms,
        });
    }

    /// Exit: Withdraw position from registry (returns position to owner)
    public fun exit<T: key + store>(
        registry: &mut LPRegistry,
        registered: RegisteredPosition,
        ctx: &mut TxContext
    ): T {
        let sender = ctx.sender();
        assert!(sender == registered.owner, E_NOT_OWNER);
        assert!(!registered.is_position_held, E_POSITION_IN_USE);

        let RegisteredPosition {
            mut id,
            owner,
            pool_id: _,
            auto_rebalance: _,
            auto_compound: _,
            recurring_count: _,
            rebalance_delay_ms: _,
            range_percent_bps: _,
            use_zap: _,
            is_paused: _,
            is_position_held: _,
            out_of_range_since: _,
            rebalance_pending: _,
            rebalance_count: _,
            compound_count: _,
            registered_at: _,
            last_activity_at: _,
        } = registered;

        let position: T = dof::remove(&mut id, b"position");
        let position_id = object::id_address(&position);
        let registry_id = object::uid_to_address(&id);

        object::delete(id);

        registry.total_exited = registry.total_exited + 1;

        event::emit(PositionExited {
            registry_id,
            position_id,
            owner,
        });

        position
    }

    /// Exit and transfer position to owner (entry function wrapper)
    public entry fun exit_and_return<T: key + store>(
        registry: &mut LPRegistry,
        registered: RegisteredPosition,
        ctx: &mut TxContext
    ) {
        let owner = registered.owner;
        let position = exit<T>(registry, registered, ctx);
        transfer::public_transfer(position, owner);
    }

    // ============ Operator Functions ============

    /// Mark position as out-of-range (starts delay timer)
    public entry fun mark_out_of_range(
        registry: &LPRegistry,
        registered: &mut RegisteredPosition,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(vec_set::contains(&registry.operators, &sender), E_NOT_OPERATOR);
        assert!(!registered.is_paused, E_POSITION_PAUSED);
        assert!(registered.auto_rebalance, E_NOT_OPERATOR); // auto_rebalance must be enabled

        let current_time = clock::timestamp_ms(clock);

        // Only set if not already pending
        if (!registered.rebalance_pending) {
            registered.out_of_range_since = current_time;
            registered.rebalance_pending = true;

            let position_id = get_position_id(registered);

            event::emit(OutOfRangeDetected {
                registry_id: object::id_address(registered),
                position_id,
                detected_at: current_time,
                rebalance_at: current_time + registered.rebalance_delay_ms,
            });
        }
    }

    /// Clear out-of-range status (price returned to range)
    public entry fun clear_out_of_range(
        registry: &LPRegistry,
        registered: &mut RegisteredPosition,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(vec_set::contains(&registry.operators, &sender), E_NOT_OPERATOR);

        if (registered.rebalance_pending) {
            registered.rebalance_pending = false;
            registered.out_of_range_since = 0;
            registered.last_activity_at = clock::timestamp_ms(clock);

            let position_id = get_position_id(registered);

            event::emit(RebalanceDelayCleared {
                registry_id: object::id_address(registered),
                position_id,
                reason: b"price_returned",
            });
        }
    }

    /// Retrieve position for rebalance/compound operation
    /// Can only be called after delay has passed
    public fun retrieve_position<T: key + store>(
        registry: &LPRegistry,
        registered: &mut RegisteredPosition,
        reason: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ): T {
        let sender = ctx.sender();
        assert!(vec_set::contains(&registry.operators, &sender), E_NOT_OPERATOR);
        assert!(!registered.is_paused, E_POSITION_PAUSED);
        assert!(!registered.is_position_held, E_POSITION_IN_USE);

        // For rebalance, check delay has passed
        if (reason == b"rebalance") {
            assert!(registered.rebalance_pending, E_NO_REBALANCE_PENDING);
            let current_time = clock::timestamp_ms(clock);
            let rebalance_allowed_at = registered.out_of_range_since + registered.rebalance_delay_ms;
            assert!(current_time >= rebalance_allowed_at, E_DELAY_NOT_EXPIRED);
        };

        let position: T = dof::remove(&mut registered.id, b"position");
        let position_id = object::id_address(&position);

        registered.is_position_held = true;
        registered.last_activity_at = clock::timestamp_ms(clock);

        event::emit(PositionRetrieved {
            registry_id: object::id_address(registered),
            position_id,
            operator: sender,
            reason,
        });

        position
    }

    /// Store position back after operation
    public fun store_position<T: key + store>(
        registered: &mut RegisteredPosition,
        position: T,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        // Owner can also store (in case of manual operations)
        assert!(registered.is_position_held, E_POSITION_NOT_IN_USE);

        let position_id = object::id_address(&position);

        dof::add(&mut registered.id, b"position", position);
        registered.is_position_held = false;
        registered.last_activity_at = clock::timestamp_ms(clock);

        event::emit(PositionStored {
            registry_id: object::id_address(registered),
            position_id,
            operator: sender,
        });
    }

    /// Store a NEW position after rebalance (old position was closed, new one opened)
    public fun store_new_position<T: key + store>(
        registry: &mut LPRegistry,
        registered: &mut RegisteredPosition,
        new_position: T,
        old_position_id: address,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(vec_set::contains(&registry.operators, &sender), E_NOT_OPERATOR);
        assert!(registered.is_position_held, E_POSITION_NOT_IN_USE);

        let new_position_id = object::id_address(&new_position);

        dof::add(&mut registered.id, b"position", new_position);

        // Update state
        registered.is_position_held = false;
        registered.rebalance_pending = false;
        registered.out_of_range_since = 0;
        registered.rebalance_count = registered.rebalance_count + 1;
        registered.last_activity_at = clock::timestamp_ms(clock);

        // Decrement recurring count if not infinite
        if (registered.recurring_count > 0) {
            registered.recurring_count = registered.recurring_count - 1;
            // If no more recurrences, disable auto-rebalance
            if (registered.recurring_count == 0) {
                registered.auto_rebalance = false;
            }
        };

        registry.total_rebalanced = registry.total_rebalanced + 1;

        event::emit(RebalanceRecorded {
            registry_id: object::id_address(registered),
            old_position_id,
            new_position_id,
            owner: registered.owner,
            rebalance_count: registered.rebalance_count,
        });
    }

    /// Record a compound operation (fees reinvested)
    public entry fun record_compound(
        registry: &mut LPRegistry,
        registered: &mut RegisteredPosition,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(vec_set::contains(&registry.operators, &sender), E_NOT_OPERATOR);

        registered.compound_count = registered.compound_count + 1;
        registered.last_activity_at = clock::timestamp_ms(clock);

        registry.total_compounded = registry.total_compounded + 1;

        let position_id = get_position_id(registered);

        event::emit(CompoundRecorded {
            registry_id: object::id_address(registered),
            position_id,
            owner: registered.owner,
            compound_count: registered.compound_count,
        });
    }

    // ============ Admin Functions ============

    /// Add an operator
    public entry fun add_operator(
        registry: &mut LPRegistry,
        operator: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registry.admin, E_NOT_ADMIN);

        if (!vec_set::contains(&registry.operators, &operator)) {
            vec_set::insert(&mut registry.operators, operator);
            event::emit(OperatorAdded { operator });
        }
    }

    /// Remove an operator
    public entry fun remove_operator(
        registry: &mut LPRegistry,
        operator: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registry.admin, E_NOT_ADMIN);

        if (vec_set::contains(&registry.operators, &operator)) {
            vec_set::remove(&mut registry.operators, &operator);
            event::emit(OperatorRemoved { operator });
        }
    }

    /// Transfer admin rights
    public entry fun transfer_admin(
        registry: &mut LPRegistry,
        new_admin: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == registry.admin, E_NOT_ADMIN);
        registry.admin = new_admin;
    }

    // ============ View Functions ============

    /// Get position info
    public fun get_position_info(registered: &RegisteredPosition): (
        address, // owner
        address, // pool_id
        bool,    // auto_rebalance
        bool,    // auto_compound
        u64,     // recurring_count
        u64,     // rebalance_delay_ms
        u64,     // range_percent_bps
        bool,    // use_zap
        bool,    // is_paused
        bool,    // is_position_held
    ) {
        (
            registered.owner,
            registered.pool_id,
            registered.auto_rebalance,
            registered.auto_compound,
            registered.recurring_count,
            registered.rebalance_delay_ms,
            registered.range_percent_bps,
            registered.use_zap,
            registered.is_paused,
            registered.is_position_held,
        )
    }

    /// Get position stats
    public fun get_position_stats(registered: &RegisteredPosition): (
        u64, // rebalance_count
        u64, // compound_count
        u64, // registered_at
        u64, // last_activity_at
    ) {
        (
            registered.rebalance_count,
            registered.compound_count,
            registered.registered_at,
            registered.last_activity_at,
        )
    }

    /// Get rebalance delay status
    public fun get_rebalance_status(registered: &RegisteredPosition, clock: &Clock): (
        bool, // rebalance_pending
        u64,  // out_of_range_since
        u64,  // time_until_rebalance (0 if can rebalance now)
    ) {
        let time_until = if (registered.rebalance_pending) {
            let current = clock::timestamp_ms(clock);
            let rebalance_at = registered.out_of_range_since + registered.rebalance_delay_ms;
            if (current >= rebalance_at) {
                0
            } else {
                rebalance_at - current
            }
        } else {
            0
        };

        (
            registered.rebalance_pending,
            registered.out_of_range_since,
            time_until,
        )
    }

    /// Check if position can be rebalanced now
    public fun can_rebalance(registered: &RegisteredPosition, clock: &Clock): bool {
        if (!registered.auto_rebalance || registered.is_paused || registered.is_position_held) {
            return false
        };

        if (!registered.rebalance_pending) {
            return false
        };

        let current = clock::timestamp_ms(clock);
        let rebalance_at = registered.out_of_range_since + registered.rebalance_delay_ms;
        current >= rebalance_at
    }

    /// Get owner
    public fun owner(registered: &RegisteredPosition): address {
        registered.owner
    }

    /// Get pool ID
    public fun pool_id(registered: &RegisteredPosition): address {
        registered.pool_id
    }

    /// Check if paused
    public fun is_paused(registered: &RegisteredPosition): bool {
        registered.is_paused
    }

    /// Check if ZAP mode is enabled
    public fun use_zap(registered: &RegisteredPosition): bool {
        registered.use_zap
    }

    /// Get registry stats
    public fun get_registry_stats(registry: &LPRegistry): (
        address, // admin
        u64,     // total_registered
        u64,     // total_rebalanced
        u64,     // total_compounded
        u64,     // total_exited
    ) {
        (
            registry.admin,
            registry.total_registered,
            registry.total_rebalanced,
            registry.total_compounded,
            registry.total_exited,
        )
    }

    /// Check if address is operator
    public fun is_operator(registry: &LPRegistry, addr: address): bool {
        vec_set::contains(&registry.operators, &addr)
    }

    // ============ Internal Functions ============

    /// Get position ID from dynamic field (for events)
    fun get_position_id(registered: &RegisteredPosition): address {
        // Return a placeholder - actual position ID would require type param
        // In practice, backend tracks this via events
        object::id_address(registered)
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
