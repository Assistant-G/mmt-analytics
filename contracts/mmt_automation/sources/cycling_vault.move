/// Cycling Vault for MMT LP Positions
///
/// A vault that holds tokens and manages LP position cycles automatically.
/// Unlike simple escrow (which only holds position), this vault:
/// - Holds actual tokens (Coin<X>, Coin<Y>)
/// - Can close and reopen positions automatically
/// - Supports infinite or limited cycles
/// - Works completely offline
///
/// Flow:
/// 1. User deposits tokens → vault opens position on MMT
/// 2. Timer expires → backend calls execute_cycle
/// 3. Contract: removes liquidity → collects fees → opens new position
/// 4. Repeat until max_cycles reached or user withdraws
/// 5. User can withdraw anytime (closes position, returns all tokens)
module mmt_automation::cycling_vault {
    use sui::clock::{Self, Clock};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::dynamic_object_field as dof;
    use sui::event;
    use sui::table::{Self, Table};
    use std::string::{Self, String};

    // ============ Error Codes ============
    const E_NOT_EXECUTOR: u64 = 1;
    const E_NOT_OWNER: u64 = 2;
    const E_NOT_EXPIRED: u64 = 3;
    const E_VAULT_NOT_ACTIVE: u64 = 4;
    const E_NO_CYCLES_REMAINING: u64 = 5;
    const E_INVALID_TIMER: u64 = 6;
    const E_INSUFFICIENT_BALANCE: u64 = 7;
    const E_POSITION_EXISTS: u64 = 8;
    const E_NO_POSITION: u64 = 9;
    const E_REBALANCE_NOT_ENABLED: u64 = 10;
    const E_NO_REBALANCE_PENDING: u64 = 11;
    const E_DELAY_NOT_EXPIRED: u64 = 12;
    const E_ALREADY_PAUSED: u64 = 13;
    const E_NOT_PAUSED: u64 = 14;

    // ============ Constants ============
    const INFINITE_CYCLES: u64 = 0; // 0 means infinite
    /// Maximum rebalance delay: 24 hours in milliseconds
    const MAX_REBALANCE_DELAY_MS: u64 = 86_400_000;

    // ============ Structs ============

    /// Global configuration (shared object)
    public struct VaultConfig has key {
        id: UID,
        /// Address authorized to execute cycles
        executor: address,
        /// Admin who can update config
        admin: address,
        /// Stats
        total_vaults: u64,
        total_cycles_executed: u64,
    }

    /// User's vault holding tokens and managing LP cycles
    /// Generic over X, Y (the token types for the pool)
    public struct Vault<phantom X, phantom Y> has key, store {
        id: UID,
        /// Owner who can withdraw
        owner: address,
        /// MMT Pool ID
        pool_id: ID,
        /// Token balances (when not in position)
        balance_x: Balance<X>,
        balance_y: Balance<Y>,
        /// Accumulated fees (separate from principal)
        fees_x: Balance<X>,
        fees_y: Balance<Y>,
        /// Accumulated rewards by coin type (e.g., xSUI)
        /// Key: coin type string, Value: amount
        rewards_collected: Table<String, u64>,

        // ============ Stats Tracking ============
        /// Initial deposit amounts (for PnL calculation)
        initial_deposit_x: u64,
        initial_deposit_y: u64,
        /// Total fees earned over lifetime (cumulative, never decreases)
        total_fees_earned_x: u64,
        total_fees_earned_y: u64,
        /// Total rewards earned by type (cumulative)
        total_rewards_earned: Table<String, u64>,
        /// When vault was created (timestamp ms)
        created_at: u64,
        /// Position opened at (timestamp ms, for current position duration)
        position_opened_at: u64,

        /// Range configuration (basis points from current tick)
        /// e.g., 500 = 5% range on each side
        range_bps: u64,
        /// Timer duration in milliseconds (for cycling mode)
        timer_duration_ms: u64,
        /// Next execution timestamp (ms)
        next_execution_at: u64,
        /// Cycle configuration
        max_cycles: u64, // 0 = infinite
        cycles_completed: u64,
        /// State
        is_active: bool,
        has_position: bool,

        // ============ Auto-Rebalance Settings ============
        /// Enable auto-rebalance when price goes out of range
        auto_rebalance: bool,
        /// Use ZAP mode - swap excess tokens to use ALL liquidity
        use_zap: bool,
        /// Enable auto-compound of fees into principal
        auto_compound: bool,
        /// Delay before rebalancing (ms) - wait for price to return
        rebalance_delay_ms: u64,
        /// Timestamp when position went out of range
        out_of_range_since: u64,
        /// Is there a pending rebalance waiting for delay
        rebalance_pending: bool,
        /// Total rebalances performed
        rebalance_count: u64,
        /// Where to send collected fees/rewards (owner or piggy bank)
        /// If zero address (0x0), fees stay in vault for compounding
        fee_recipient: address,
        /// Maximum slippage allowed for ZAP swaps (in basis points, e.g., 100 = 1%)
        /// If 0, no slippage check (default behavior)
        max_zap_slippage_bps: u64,
    }

    // Position stored as dynamic object field with key b"position"
    // when has_position = true

    // ============ Events ============

    public struct VaultCreated has copy, drop {
        vault_id: address,
        owner: address,
        pool_id: ID,
        range_bps: u64,
        timer_duration_ms: u64,
        max_cycles: u64,
    }

    public struct VaultDeposit has copy, drop {
        vault_id: address,
        amount_x: u64,
        amount_y: u64,
    }

    public struct CycleExecuted has copy, drop {
        vault_id: address,
        cycle_number: u64,
        removed_x: u64,
        removed_y: u64,
        fees_x: u64,
        fees_y: u64,
    }

    public struct PositionOpened has copy, drop {
        vault_id: address,
        position_id: address,
        amount_x: u64,
        amount_y: u64,
    }

    public struct VaultWithdrawn has copy, drop {
        vault_id: address,
        owner: address,
        total_x: u64,
        total_y: u64,
    }

    public struct VaultPaused has copy, drop {
        vault_id: address,
    }

    public struct VaultResumed has copy, drop {
        vault_id: address,
        next_execution_at: u64,
    }

    public struct FeesCompounded has copy, drop {
        vault_id: address,
        compounded_x: u64,
        compounded_y: u64,
    }

    public struct LeftoverDeposited has copy, drop {
        vault_id: address,
        amount_x: u64,
        amount_y: u64,
    }

    public struct RewardsCollected has copy, drop {
        vault_id: address,
        coin_type: String,
        amount: u64,
    }

    public struct OutOfRangeDetected has copy, drop {
        vault_id: address,
        detected_at: u64,
        rebalance_at: u64, // when rebalance can happen (detected_at + delay)
    }

    public struct RebalanceDelayCleared has copy, drop {
        vault_id: address,
        reason: vector<u8>, // "price_returned" or "cancelled"
    }

    public struct RebalanceExecuted has copy, drop {
        vault_id: address,
        rebalance_count: u64,
        used_zap: bool,
        /// Actual amount swapped in (0 if no swap occurred)
        amount_in: u64,
        /// Actual amount received from swap (0 if no swap occurred)
        amount_out: u64,
        /// Swap direction: true = X to Y, false = Y to X
        swap_x_to_y: bool,
    }

    public struct RebalanceSettingsUpdated has copy, drop {
        vault_id: address,
        auto_rebalance: bool,
        use_zap: bool,
        auto_compound: bool,
        rebalance_delay_ms: u64,
    }

    public struct FeeRecipientUpdated has copy, drop {
        vault_id: address,
        old_recipient: address,
        new_recipient: address,
    }

    public struct FeesWithdrawn has copy, drop {
        vault_id: address,
        recipient: address,
        amount_x: u64,
        amount_y: u64,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let sender = ctx.sender();

        let config = VaultConfig {
            id: object::new(ctx),
            executor: sender,
            admin: sender,
            total_vaults: 0,
            total_cycles_executed: 0,
        };

        transfer::share_object(config);
    }

    // ============ User Functions ============

    /// Create a new vault with initial token deposit
    /// Opens a position immediately
    public fun create_vault<X, Y>(
        config: &mut VaultConfig,
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        pool_id: ID,
        range_bps: u64,
        timer_duration_ms: u64,
        max_cycles: u64,
        auto_rebalance: bool,
        use_zap: bool,
        auto_compound: bool,
        rebalance_delay_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): Vault<X, Y> {
        // Timer can be 0 if using auto-rebalance mode only
        assert!(timer_duration_ms > 0 || auto_rebalance, E_INVALID_TIMER);

        let sender = ctx.sender();
        let amount_x = coin::value(&coin_x);
        let amount_y = coin::value(&coin_y);
        let current_time = clock::timestamp_ms(clock);

        let vault = Vault<X, Y> {
            id: object::new(ctx),
            owner: sender,
            pool_id,
            balance_x: coin::into_balance(coin_x),
            balance_y: coin::into_balance(coin_y),
            fees_x: balance::zero(),
            fees_y: balance::zero(),
            rewards_collected: table::new(ctx),
            // Stats tracking
            initial_deposit_x: amount_x,
            initial_deposit_y: amount_y,
            total_fees_earned_x: 0,
            total_fees_earned_y: 0,
            total_rewards_earned: table::new(ctx),
            created_at: current_time,
            position_opened_at: 0,
            // Settings
            range_bps,
            timer_duration_ms,
            next_execution_at: if (timer_duration_ms > 0) { current_time + timer_duration_ms } else { 0 },
            max_cycles,
            cycles_completed: 0,
            is_active: true,
            has_position: false,
            // Auto-rebalance settings
            auto_rebalance,
            use_zap,
            auto_compound,
            rebalance_delay_ms,
            out_of_range_since: 0,
            rebalance_pending: false,
            rebalance_count: 0,
            fee_recipient: @0x0, // Default: fees stay in vault
            max_zap_slippage_bps: 0, // Default: no slippage check
        };

        let vault_id = object::id_address(&vault);

        config.total_vaults = config.total_vaults + 1;

        event::emit(VaultCreated {
            vault_id,
            owner: sender,
            pool_id,
            range_bps,
            timer_duration_ms,
            max_cycles,
        });

        event::emit(VaultDeposit {
            vault_id,
            amount_x,
            amount_y,
        });

        vault
    }

    /// Create vault and share it (entry function)
    public entry fun create_and_share_vault<X, Y>(
        config: &mut VaultConfig,
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        pool_id: ID,
        range_bps: u64,
        timer_duration_ms: u64,
        max_cycles: u64,
        auto_rebalance: bool,
        use_zap: bool,
        auto_compound: bool,
        rebalance_delay_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let vault = create_vault<X, Y>(
            config,
            coin_x,
            coin_y,
            pool_id,
            range_bps,
            timer_duration_ms,
            max_cycles,
            auto_rebalance,
            use_zap,
            auto_compound,
            rebalance_delay_ms,
            clock,
            ctx
        );
        transfer::share_object(vault);
    }

    /// Deposit additional tokens into vault
    public entry fun deposit<X, Y>(
        vault: &mut Vault<X, Y>,
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);

        let amount_x = coin::value(&coin_x);
        let amount_y = coin::value(&coin_y);

        balance::join(&mut vault.balance_x, coin::into_balance(coin_x));
        balance::join(&mut vault.balance_y, coin::into_balance(coin_y));

        // Track as additional initial deposit for accurate PnL
        vault.initial_deposit_x = vault.initial_deposit_x + amount_x;
        vault.initial_deposit_y = vault.initial_deposit_y + amount_y;

        event::emit(VaultDeposit {
            vault_id: object::id_address(vault),
            amount_x,
            amount_y,
        });
    }

    /// Pause the vault (stop cycling)
    public entry fun pause<X, Y>(
        vault: &mut Vault<X, Y>,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);

        vault.is_active = false;

        event::emit(VaultPaused {
            vault_id: object::id_address(vault),
        });
    }

    /// Resume the vault
    public entry fun resume<X, Y>(
        vault: &mut Vault<X, Y>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);

        let current_time = clock::timestamp_ms(clock);
        vault.is_active = true;
        vault.next_execution_at = current_time + vault.timer_duration_ms;

        event::emit(VaultResumed {
            vault_id: object::id_address(vault),
            next_execution_at: vault.next_execution_at,
        });
    }

    /// Update vault settings (timer/cycling mode)
    public entry fun update_settings<X, Y>(
        vault: &mut Vault<X, Y>,
        range_bps: u64,
        timer_duration_ms: u64,
        max_cycles: u64,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);
        // Timer can be 0 if using auto-rebalance mode only
        assert!(timer_duration_ms > 0 || vault.auto_rebalance, E_INVALID_TIMER);

        vault.range_bps = range_bps;
        vault.timer_duration_ms = timer_duration_ms;
        vault.max_cycles = max_cycles;
    }

    /// Update rebalance settings (ZAP, auto-rebalance, auto-compound, slippage)
    public entry fun update_rebalance_settings<X, Y>(
        vault: &mut Vault<X, Y>,
        auto_rebalance: bool,
        use_zap: bool,
        auto_compound: bool,
        rebalance_delay_ms: u64,
        max_zap_slippage_bps: u64,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);
        assert!(rebalance_delay_ms <= MAX_REBALANCE_DELAY_MS, E_INVALID_TIMER);
        assert!(max_zap_slippage_bps <= 1000, E_INVALID_TIMER); // Max 10% slippage

        vault.auto_rebalance = auto_rebalance;
        vault.use_zap = use_zap;
        vault.auto_compound = auto_compound;
        vault.rebalance_delay_ms = rebalance_delay_ms;
        vault.max_zap_slippage_bps = max_zap_slippage_bps;

        event::emit(RebalanceSettingsUpdated {
            vault_id: object::id_address(vault),
            auto_rebalance,
            use_zap,
            auto_compound,
            rebalance_delay_ms,
        });
    }

    /// Set fee recipient address (where fees/rewards go)
    /// Set to 0x0 to keep fees in vault for compounding
    public entry fun set_fee_recipient<X, Y>(
        vault: &mut Vault<X, Y>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);

        let old_recipient = vault.fee_recipient;
        vault.fee_recipient = recipient;

        event::emit(FeeRecipientUpdated {
            vault_id: object::id_address(vault),
            old_recipient,
            new_recipient: recipient,
        });
    }

    /// Owner requests immediate rebalance (marks vault for rebalance)
    /// This allows the owner to trigger a rebalance even if position is in range
    public entry fun request_rebalance<X, Y>(
        vault: &mut Vault<X, Y>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);
        assert!(vault.is_active, E_VAULT_NOT_ACTIVE);
        assert!(vault.auto_rebalance, E_REBALANCE_NOT_ENABLED);

        let current_time = clock::timestamp_ms(clock);

        // Set as pending with current time (delay will be applied)
        vault.out_of_range_since = current_time;
        vault.rebalance_pending = true;

        event::emit(OutOfRangeDetected {
            vault_id: object::id_address(vault),
            detected_at: current_time,
            rebalance_at: current_time + vault.rebalance_delay_ms,
        });
    }

    /// Withdraw accumulated fees to recipient (or owner if no recipient set)
    public entry fun withdraw_fees<X, Y>(
        vault: &mut Vault<X, Y>,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);

        let fee_x_amount = balance::value(&vault.fees_x);
        let fee_y_amount = balance::value(&vault.fees_y);

        if (fee_x_amount > 0 || fee_y_amount > 0) {
            let fees_x = balance::withdraw_all(&mut vault.fees_x);
            let fees_y = balance::withdraw_all(&mut vault.fees_y);

            let recipient = if (vault.fee_recipient == @0x0) {
                vault.owner
            } else {
                vault.fee_recipient
            };

            transfer::public_transfer(coin::from_balance(fees_x, ctx), recipient);
            transfer::public_transfer(coin::from_balance(fees_y, ctx), recipient);

            event::emit(FeesWithdrawn {
                vault_id: object::id_address(vault),
                recipient,
                amount_x: fee_x_amount,
                amount_y: fee_y_amount,
            });
        };
    }

    /// Withdraw all tokens and close vault
    /// If there's an active position, it must be closed first by backend
    public fun withdraw<X, Y>(
        config: &mut VaultConfig,
        vault: Vault<X, Y>,
        ctx: &mut TxContext
    ): (Coin<X>, Coin<Y>) {
        let sender = ctx.sender();
        assert!(sender == vault.owner, E_NOT_OWNER);
        assert!(!vault.has_position, E_POSITION_EXISTS);

        let Vault {
            id,
            owner,
            pool_id: _,
            balance_x,
            balance_y,
            fees_x,
            fees_y,
            rewards_collected,
            // Stats fields
            initial_deposit_x: _,
            initial_deposit_y: _,
            total_fees_earned_x: _,
            total_fees_earned_y: _,
            total_rewards_earned,
            created_at: _,
            position_opened_at: _,
            // Settings
            range_bps: _,
            timer_duration_ms: _,
            next_execution_at: _,
            max_cycles: _,
            cycles_completed: _,
            is_active: _,
            has_position: _,
            // Rebalance fields
            auto_rebalance: _,
            use_zap: _,
            auto_compound: _,
            rebalance_delay_ms: _,
            out_of_range_since: _,
            rebalance_pending: _,
            rebalance_count: _,
            fee_recipient: _,
        } = vault;

        // Clean up tables
        table::drop(rewards_collected);
        table::drop(total_rewards_earned);

        // Combine principal and fees
        let mut total_x = balance_x;
        let mut total_y = balance_y;
        balance::join(&mut total_x, fees_x);
        balance::join(&mut total_y, fees_y);

        let amount_x = balance::value(&total_x);
        let amount_y = balance::value(&total_y);

        event::emit(VaultWithdrawn {
            vault_id: object::uid_to_address(&id),
            owner,
            total_x: amount_x,
            total_y: amount_y,
        });

        object::delete(id);

        (coin::from_balance(total_x, ctx), coin::from_balance(total_y, ctx))
    }

    /// Withdraw and transfer to owner (entry function)
    public entry fun withdraw_and_transfer<X, Y>(
        config: &mut VaultConfig,
        vault: Vault<X, Y>,
        ctx: &mut TxContext
    ) {
        let owner = vault.owner;
        let (coin_x, coin_y) = withdraw<X, Y>(config, vault, ctx);
        transfer::public_transfer(coin_x, owner);
        transfer::public_transfer(coin_y, owner);
    }

    // ============ Executor Functions ============
    // These are called by the backend to manage positions

    /// Store a position in the vault (called after opening position)
    public fun store_position<X, Y, P: key + store>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        position: P,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);
        assert!(!vault.has_position, E_POSITION_EXISTS);

        let position_id = object::id_address(&position);
        dof::add(&mut vault.id, b"position", position);
        vault.has_position = true;
        vault.position_opened_at = clock::timestamp_ms(clock);

        event::emit(PositionOpened {
            vault_id: object::id_address(vault),
            position_id,
            amount_x: 0, // Actual amounts tracked by MMT
            amount_y: 0,
        });
    }

    /// Retrieve position from vault (for closing)
    public fun retrieve_position<X, Y, P: key + store>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        ctx: &mut TxContext
    ): P {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin || sender == vault.owner, E_NOT_EXECUTOR);
        assert!(vault.has_position, E_NO_POSITION);

        vault.has_position = false;
        dof::remove(&mut vault.id, b"position")
    }

    /// Deposit proceeds from closing a position
    public fun deposit_proceeds<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        coin_x: Coin<X>,
        coin_y: Coin<Y>,
        fees_x: Coin<X>,
        fees_y: Coin<Y>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        // Add principal back
        balance::join(&mut vault.balance_x, coin::into_balance(coin_x));
        balance::join(&mut vault.balance_y, coin::into_balance(coin_y));

        // Add fees and track cumulative
        let fee_x_amount = coin::value(&fees_x);
        let fee_y_amount = coin::value(&fees_y);
        balance::join(&mut vault.fees_x, coin::into_balance(fees_x));
        balance::join(&mut vault.fees_y, coin::into_balance(fees_y));

        // Track cumulative fees earned
        vault.total_fees_earned_x = vault.total_fees_earned_x + fee_x_amount;
        vault.total_fees_earned_y = vault.total_fees_earned_y + fee_y_amount;

        let removed_x = balance::value(&vault.balance_x);
        let removed_y = balance::value(&vault.balance_y);

        // Update cycle tracking
        vault.cycles_completed = vault.cycles_completed + 1;

        // Check if should continue cycling
        let should_continue = vault.is_active &&
            (vault.max_cycles == INFINITE_CYCLES || vault.cycles_completed < vault.max_cycles);

        if (should_continue) {
            // Set next execution time
            vault.next_execution_at = clock::timestamp_ms(clock) + vault.timer_duration_ms;
        } else {
            vault.is_active = false;
        };

        event::emit(CycleExecuted {
            vault_id: object::id_address(vault),
            cycle_number: vault.cycles_completed,
            removed_x,
            removed_y,
            fees_x: fee_x_amount,
            fees_y: fee_y_amount,
        });
    }

    /// Compound accumulated fees into principal balance for reinvestment
    /// This should be called before opening a new position to maximize liquidity
    public fun compound_fees<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        // Get fee amounts before moving
        let fee_x_amount = balance::value(&vault.fees_x);
        let fee_y_amount = balance::value(&vault.fees_y);

        // Only proceed if there are fees to compound
        if (fee_x_amount > 0 || fee_y_amount > 0) {
            // Move all fees into principal balance
            let fees_x = balance::withdraw_all(&mut vault.fees_x);
            let fees_y = balance::withdraw_all(&mut vault.fees_y);

            balance::join(&mut vault.balance_x, fees_x);
            balance::join(&mut vault.balance_y, fees_y);

            event::emit(FeesCompounded {
                vault_id: object::id_address(vault),
                compounded_x: fee_x_amount,
                compounded_y: fee_y_amount,
            });
        };
    }

    /// Take tokens from vault for opening a position
    public fun take_for_position<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        ctx: &mut TxContext
    ): (Coin<X>, Coin<Y>) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);
        assert!(vault.is_active, E_VAULT_NOT_ACTIVE);
        assert!(!vault.has_position, E_POSITION_EXISTS);

        let amount_x = balance::value(&vault.balance_x);
        let amount_y = balance::value(&vault.balance_y);

        let coin_x = coin::from_balance(balance::withdraw_all(&mut vault.balance_x), ctx);
        let coin_y = coin::from_balance(balance::withdraw_all(&mut vault.balance_y), ctx);

        (coin_x, coin_y)
    }

    /// Deposit leftover tokens back into vault (instead of sending to wallet)
    /// Called after opening position when there are leftover tokens
    public fun deposit_leftover<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        leftover_x: Coin<X>,
        leftover_y: Coin<Y>,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        let amount_x = coin::value(&leftover_x);
        let amount_y = coin::value(&leftover_y);

        // Add leftover back to vault balance
        balance::join(&mut vault.balance_x, coin::into_balance(leftover_x));
        balance::join(&mut vault.balance_y, coin::into_balance(leftover_y));

        event::emit(LeftoverDeposited {
            vault_id: object::id_address(vault),
            amount_x,
            amount_y,
        });
    }

    /// Deposit reward tokens into vault tracking
    /// Called when collecting rewards (e.g., xSUI) from MMT pools
    public entry fun deposit_reward<X, Y, R>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        reward_coin: Coin<R>,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        let amount = coin::value(&reward_coin);

        // Get coin type as string
        let coin_type = std::type_name::get<R>();
        let coin_type_str = string::from_ascii(std::type_name::into_string(coin_type));

        // Update rewards tracking tables
        if (table::contains(&vault.rewards_collected, coin_type_str)) {
            let current = table::remove(&mut vault.rewards_collected, coin_type_str);
            table::add(&mut vault.rewards_collected, coin_type_str, current + amount);
        } else {
            table::add(&mut vault.rewards_collected, coin_type_str, amount);
        };

        // Track cumulative rewards (never decreases)
        if (table::contains(&vault.total_rewards_earned, coin_type_str)) {
            let current = table::remove(&mut vault.total_rewards_earned, coin_type_str);
            table::add(&mut vault.total_rewards_earned, coin_type_str, current + amount);
        } else {
            table::add(&mut vault.total_rewards_earned, coin_type_str, amount);
        };

        // Transfer reward coin to vault owner
        transfer::public_transfer(reward_coin, vault.owner);

        event::emit(RewardsCollected {
            vault_id: object::id_address(vault),
            coin_type: coin_type_str,
            amount,
        });
    }

    /// Track reward amount without receiving the coin (for auto-rebalance mode)
    /// The reward is sent directly to owner, but we still track it for stats
    public fun track_reward<X, Y, R>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        amount: u64,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        if (amount == 0) {
            return
        };

        // Get coin type as string
        let coin_type = std::type_name::get<R>();
        let coin_type_str = string::from_ascii(std::type_name::into_string(coin_type));

        // Track cumulative rewards (never decreases)
        if (table::contains(&vault.total_rewards_earned, coin_type_str)) {
            let current = table::remove(&mut vault.total_rewards_earned, coin_type_str);
            table::add(&mut vault.total_rewards_earned, coin_type_str, current + amount);
        } else {
            table::add(&mut vault.total_rewards_earned, coin_type_str, amount);
        };

        event::emit(RewardsCollected {
            vault_id: object::id_address(vault),
            coin_type: coin_type_str,
            amount,
        });
    }

    /// Track fees earned (for auto-rebalance mode where fees are reinvested)
    public fun track_fees<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        fee_x: u64,
        fee_y: u64,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        // Track cumulative fees earned
        vault.total_fees_earned_x = vault.total_fees_earned_x + fee_x;
        vault.total_fees_earned_y = vault.total_fees_earned_y + fee_y;
    }

    /// Check if vault is ready for cycle execution (timer-based)
    public fun is_ready_for_cycle<X, Y>(vault: &Vault<X, Y>, clock: &Clock): bool {
        if (!vault.is_active) {
            return false
        };

        // Skip if timer is disabled (rebalance-only mode)
        if (vault.timer_duration_ms == 0) {
            return false
        };

        // Check max cycles
        if (vault.max_cycles != INFINITE_CYCLES && vault.cycles_completed >= vault.max_cycles) {
            return false
        };

        // Check timer
        clock::timestamp_ms(clock) >= vault.next_execution_at
    }

    // ============ Rebalance Functions (Executor) ============

    /// Mark vault position as out-of-range (starts delay timer)
    public entry fun mark_out_of_range<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);
        assert!(vault.is_active, E_VAULT_NOT_ACTIVE);
        assert!(vault.auto_rebalance, E_REBALANCE_NOT_ENABLED);

        let current_time = clock::timestamp_ms(clock);

        // Only set if not already pending
        if (!vault.rebalance_pending) {
            vault.out_of_range_since = current_time;
            vault.rebalance_pending = true;

            event::emit(OutOfRangeDetected {
                vault_id: object::id_address(vault),
                detected_at: current_time,
                rebalance_at: current_time + vault.rebalance_delay_ms,
            });
        }
    }

    /// Clear out-of-range status (price returned to range)
    public entry fun clear_out_of_range<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        if (vault.rebalance_pending) {
            vault.rebalance_pending = false;
            vault.out_of_range_since = 0;

            event::emit(RebalanceDelayCleared {
                vault_id: object::id_address(vault),
                reason: b"price_returned",
            });
        }
    }

    /// Check if vault can be rebalanced now (delay has passed)
    public fun can_rebalance<X, Y>(vault: &Vault<X, Y>, clock: &Clock): bool {
        if (!vault.is_active || !vault.auto_rebalance) {
            return false
        };

        if (!vault.rebalance_pending) {
            return false
        };

        let current = clock::timestamp_ms(clock);
        let rebalance_at = vault.out_of_range_since + vault.rebalance_delay_ms;
        current >= rebalance_at
    }

    /// Record a rebalance operation (called after rebalance is complete)
    /// amount_in: actual amount swapped in (0 if no swap)
    /// amount_out: actual amount received from swap (0 if no swap)
    /// swap_x_to_y: swap direction (true = X to Y, false = Y to X)
    public fun record_rebalance<X, Y>(
        config: &VaultConfig,
        vault: &mut Vault<X, Y>,
        amount_in: u64,
        amount_out: u64,
        swap_x_to_y: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.executor || sender == config.admin, E_NOT_EXECUTOR);

        // Clear pending state
        vault.rebalance_pending = false;
        vault.out_of_range_since = 0;
        vault.rebalance_count = vault.rebalance_count + 1;

        // If auto-compound is enabled, compound fees before next position open
        if (vault.auto_compound) {
            let fee_x_amount = balance::value(&vault.fees_x);
            let fee_y_amount = balance::value(&vault.fees_y);

            if (fee_x_amount > 0 || fee_y_amount > 0) {
                let fees_x = balance::withdraw_all(&mut vault.fees_x);
                let fees_y = balance::withdraw_all(&mut vault.fees_y);

                balance::join(&mut vault.balance_x, fees_x);
                balance::join(&mut vault.balance_y, fees_y);

                event::emit(FeesCompounded {
                    vault_id: object::id_address(vault),
                    compounded_x: fee_x_amount,
                    compounded_y: fee_y_amount,
                });
            };
        };

        event::emit(RebalanceExecuted {
            vault_id: object::id_address(vault),
            rebalance_count: vault.rebalance_count,
            used_zap: vault.use_zap,
            amount_in,
            amount_out,
            swap_x_to_y,
        });
    }

    /// Get rebalance status
    public fun get_rebalance_status<X, Y>(vault: &Vault<X, Y>, clock: &Clock): (
        bool, // rebalance_pending
        u64,  // out_of_range_since
        u64,  // time_until_rebalance (0 if can rebalance now)
    ) {
        let time_until = if (vault.rebalance_pending) {
            let current = clock::timestamp_ms(clock);
            let rebalance_at = vault.out_of_range_since + vault.rebalance_delay_ms;
            if (current >= rebalance_at) {
                0
            } else {
                rebalance_at - current
            }
        } else {
            0
        };

        (
            vault.rebalance_pending,
            vault.out_of_range_since,
            time_until,
        )
    }

    // ============ Admin Functions ============

    /// Update executor address
    public entry fun set_executor(
        config: &mut VaultConfig,
        new_executor: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.admin, E_NOT_OWNER);
        config.executor = new_executor;
    }

    /// Transfer admin
    public entry fun transfer_admin(
        config: &mut VaultConfig,
        new_admin: address,
        ctx: &mut TxContext
    ) {
        let sender = ctx.sender();
        assert!(sender == config.admin, E_NOT_OWNER);
        config.admin = new_admin;
    }

    // ============ View Functions ============

    public fun get_vault_info<X, Y>(vault: &Vault<X, Y>): (
        address,    // owner
        ID,         // pool_id
        u64,        // balance_x
        u64,        // balance_y
        u64,        // fees_x
        u64,        // fees_y
        u64,        // range_bps
        u64,        // timer_duration_ms
        u64,        // next_execution_at
        u64,        // max_cycles
        u64,        // cycles_completed
        bool,       // is_active
        bool,       // has_position
    ) {
        (
            vault.owner,
            vault.pool_id,
            balance::value(&vault.balance_x),
            balance::value(&vault.balance_y),
            balance::value(&vault.fees_x),
            balance::value(&vault.fees_y),
            vault.range_bps,
            vault.timer_duration_ms,
            vault.next_execution_at,
            vault.max_cycles,
            vault.cycles_completed,
            vault.is_active,
            vault.has_position,
        )
    }

    public fun owner<X, Y>(vault: &Vault<X, Y>): address {
        vault.owner
    }

    public fun pool_id<X, Y>(vault: &Vault<X, Y>): ID {
        vault.pool_id
    }

    public fun is_active<X, Y>(vault: &Vault<X, Y>): bool {
        vault.is_active
    }

    public fun has_position<X, Y>(vault: &Vault<X, Y>): bool {
        vault.has_position
    }

    public fun cycles_completed<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.cycles_completed
    }

    public fun max_cycles<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.max_cycles
    }

    public fun range_bps<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.range_bps
    }

    public fun next_execution_at<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.next_execution_at
    }

    public fun get_config_info(config: &VaultConfig): (address, address, u64, u64) {
        (
            config.executor,
            config.admin,
            config.total_vaults,
            config.total_cycles_executed,
        )
    }

    public fun get_reward_amount<X, Y>(vault: &Vault<X, Y>, coin_type: String): u64 {
        if (table::contains(&vault.rewards_collected, coin_type)) {
            *table::borrow(&vault.rewards_collected, coin_type)
        } else {
            0
        }
    }

    /// Get total rewards earned (cumulative, never decreases)
    public fun get_total_reward_earned<X, Y>(vault: &Vault<X, Y>, coin_type: String): u64 {
        if (table::contains(&vault.total_rewards_earned, coin_type)) {
            *table::borrow(&vault.total_rewards_earned, coin_type)
        } else {
            0
        }
    }

    /// Get vault stats for PnL calculation
    public fun get_vault_stats<X, Y>(vault: &Vault<X, Y>): (
        u64,  // initial_deposit_x
        u64,  // initial_deposit_y
        u64,  // total_fees_earned_x
        u64,  // total_fees_earned_y
        u64,  // created_at
        u64,  // position_opened_at
    ) {
        (
            vault.initial_deposit_x,
            vault.initial_deposit_y,
            vault.total_fees_earned_x,
            vault.total_fees_earned_y,
            vault.created_at,
            vault.position_opened_at,
        )
    }

    public fun initial_deposit_x<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.initial_deposit_x
    }

    public fun initial_deposit_y<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.initial_deposit_y
    }

    public fun total_fees_earned_x<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.total_fees_earned_x
    }

    public fun total_fees_earned_y<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.total_fees_earned_y
    }

    public fun created_at<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.created_at
    }

    public fun position_opened_at<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.position_opened_at
    }

    // ============ Rebalance View Functions ============

    /// Get all rebalance settings
    public fun get_rebalance_settings<X, Y>(vault: &Vault<X, Y>): (
        bool,    // auto_rebalance
        bool,    // use_zap
        bool,    // auto_compound
        u64,     // rebalance_delay_ms
        u64,     // rebalance_count
        address, // fee_recipient
        u64,     // max_zap_slippage_bps
    ) {
        (
            vault.auto_rebalance,
            vault.use_zap,
            vault.auto_compound,
            vault.rebalance_delay_ms,
            vault.rebalance_count,
            vault.fee_recipient,
            vault.max_zap_slippage_bps,
        )
    }

    public fun auto_rebalance<X, Y>(vault: &Vault<X, Y>): bool {
        vault.auto_rebalance
    }

    public fun use_zap<X, Y>(vault: &Vault<X, Y>): bool {
        vault.use_zap
    }

    public fun auto_compound<X, Y>(vault: &Vault<X, Y>): bool {
        vault.auto_compound
    }

    public fun rebalance_delay_ms<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.rebalance_delay_ms
    }

    public fun rebalance_count<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.rebalance_count
    }

    public fun max_zap_slippage_bps<X, Y>(vault: &Vault<X, Y>): u64 {
        vault.max_zap_slippage_bps
    }

    public fun rebalance_pending<X, Y>(vault: &Vault<X, Y>): bool {
        vault.rebalance_pending
    }

    public fun fee_recipient<X, Y>(vault: &Vault<X, Y>): address {
        vault.fee_recipient
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx)
    }
}
