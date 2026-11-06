import React, { useState } from 'react';
import { money, downloadCsv } from './api';

const PRESETS = [
  {
    id: 'league',
    label: '⛳ Weekly League',
    desc: '36 golfers · 16 weeks · partner course',
    members: 36,
    duesPerMember: 75,
    eventsCount: 16,
    playersPerEvent: 32,
    entryFee: 35,
    addonsPerPlayer: 12,
    sponsorsPerEvent: 250,
    donationsPerEvent: 0,
    seasonMonths: 5,
    planTier: 'free',
    proMonthly: 59,
    legacyMonthly: 99,
    legacyFeePct: 7.0,
    passFeeToPlayer: true,
  },
  {
    id: 'tour',
    label: '🏆 Club Tour',
    desc: '80 members · 10 tournaments · multi-course',
    members: 80,
    duesPerMember: 150,
    eventsCount: 10,
    playersPerEvent: 64,
    entryFee: 85,
    addonsPerPlayer: 20,
    sponsorsPerEvent: 1200,
    donationsPerEvent: 150,
    seasonMonths: 7,
    planTier: 'pro',
    proMonthly: 59,
    legacyMonthly: 149,
    legacyFeePct: 7.0,
    passFeeToPlayer: true,
  },
  {
    id: 'charity',
    label: '🎗️ Charity Outing',
    desc: '128 golfers · sponsors · Mulligans & raffle',
    members: 0,
    duesPerMember: 0,
    eventsCount: 2,
    playersPerEvent: 128,
    entryFee: 150,
    addonsPerPlayer: 45,
    sponsorsPerEvent: 6500,
    donationsPerEvent: 4000,
    seasonMonths: 3,
    planTier: 'pro',
    proMonthly: 59,
    legacyMonthly: 199,
    legacyFeePct: 7.5,
    passFeeToPlayer: true,
  },
  {
    id: 'operator',
    label: '🏌️‍♂️ Course Operator',
    desc: 'Orion multi-league · 32 events + turn shop',
    members: 240,
    duesPerMember: 110,
    eventsCount: 32,
    playersPerEvent: 56,
    entryFee: 65,
    addonsPerPlayer: 24,
    sponsorsPerEvent: 750,
    donationsPerEvent: 100,
    seasonMonths: 8,
    planTier: 'pro',
    proMonthly: 59,
    legacyMonthly: 249,
    legacyFeePct: 7.0,
    passFeeToPlayer: true,
  },
];

const fmtUsd = (dollars) =>
  '$' + Math.round(dollars || 0).toLocaleString();

export default function RevenueForecast({ initialPreset = 'tour', showPlatformScale = true }) {
  const [activePreset, setActivePreset] = useState(initialPreset);
  const start = PRESETS.find((p) => p.id === initialPreset) || PRESETS[1];

  // Club / League / Event Season Inputs
  const [members, setMembers] = useState(start.members);
  const [duesPerMember, setDuesPerMember] = useState(start.duesPerMember);
  const [eventsCount, setEventsCount] = useState(start.eventsCount);
  const [playersPerEvent, setPlayersPerEvent] = useState(start.playersPerEvent);
  const [entryFee, setEntryFee] = useState(start.entryFee);
  const [addonsPerPlayer, setAddonsPerPlayer] = useState(start.addonsPerPlayer);
  const [sponsorsPerEvent, setSponsorsPerEvent] = useState(start.sponsorsPerEvent);
  const [donationsPerEvent, setDonationsPerEvent] = useState(start.donationsPerEvent);
  const [seasonMonths, setSeasonMonths] = useState(start.seasonMonths);

  // Software & Pricing Inputs
  const [planTier, setPlanTier] = useState(start.planTier); // 'free' | 'pro'
  const [proMonthly, setProMonthly] = useState(start.proMonthly); // $49 - $79/mo
  const [passFeeToPlayer, setPassFeeToPlayer] = useState(start.passFeeToPlayer);
  const [legacyMonthly, setLegacyMonthly] = useState(start.legacyMonthly); // e.g. $99-$249/mo today
  const [legacyFeePct, setLegacyFeePct] = useState(start.legacyFeePct); // e.g. 7.0%

  // Platform-wide Monetization Scale (for Admin forecasting across multiple clubs)
  const [clubCount, setClubCount] = useState(15);
  const [proAdoptionPct, setProAdoptionPct] = useState(60);

  const applyPreset = (p) => {
    setActivePreset(p.id);
    setMembers(p.members);
    setDuesPerMember(p.duesPerMember);
    setEventsCount(p.eventsCount);
    setPlayersPerEvent(p.playersPerEvent);
    setEntryFee(p.entryFee);
    setAddonsPerPlayer(p.addonsPerPlayer);
    setSponsorsPerEvent(p.sponsorsPerEvent);
    setDonationsPerEvent(p.donationsPerEvent);
    setSeasonMonths(p.seasonMonths);
    setPlanTier(p.planTier);
    setProMonthly(p.proMonthly);
    setLegacyMonthly(p.legacyMonthly);
    setLegacyFeePct(p.legacyFeePct);
    setPassFeeToPlayer(p.passFeeToPlayer);
  };

  // 1. Season Collection Breakdown ($)
  const totalRounds = eventsCount * playersPerEvent;
  const duesCollected = members * duesPerMember;
  const entriesCollected = totalRounds * entryFee;
  const addonsCollected = totalRounds * addonsPerPlayer;
  const sponsorsCollected = eventsCount * sponsorsPerEvent;
  const donationsCollected = eventsCount * donationsPerEvent;
  const grossSeasonCollected =
    duesCollected +
    entriesCollected +
    addonsCollected +
    sponsorsCollected +
    donationsCollected;

  // Estimated number of checkout transactions in the season
  const txCount = Math.max(1, members + totalRounds + eventsCount * 2);

  // 2. ForeSome vs. Current Software Cost Comparison
  // ForeSome All-in Fee: 6.5% on Community Free, 5.5% on Community Pro
  const foresomeFeePct = planTier === 'pro' ? 5.5 : 6.5;
  const foresomeSubCost = planTier === 'pro' ? proMonthly * seasonMonths : 0;
  const foresomeProcessingDollars =
    grossSeasonCollected * (foresomeFeePct / 100) + txCount * 0.3;

  // What the club actually pays out of pocket on ForeSome
  const foresomeClubOutOfPocket = passFeeToPlayer
    ? foresomeSubCost
    : foresomeSubCost + foresomeProcessingDollars;
  const foresomeNetToClub = grossSeasonCollected - foresomeClubOutOfPocket;

  // Legacy Software Today (e.g., Parfour Pro $99/mo + 6-7% or Golf Genius + Stripe)
  const legacySubCost = legacyMonthly * seasonMonths;
  const legacyProcessingDollars =
    grossSeasonCollected * (legacyFeePct / 100) + txCount * 0.3;
  const legacyTotalCostWhenAbsorbed = legacySubCost + legacyProcessingDollars;
  const legacyClubCostComparison = passFeeToPlayer
    ? legacySubCost + grossSeasonCollected * (Math.max(0, legacyFeePct - foresomeFeePct) / 100)
    : legacyTotalCostWhenAbsorbed;

  const clubSeasonSavings = Math.max(0, legacyClubCostComparison - foresomeClubOutOfPocket);

  // 3. ForeSome Platform Monetization (What ForeSome Earns)
  // Stripe's underlying wholesale cost (~2.9% + $0.30/tx)
  const stripeWholesaleCost = grossSeasonCollected * 0.029 + txCount * 0.3;
  const foresomeNetTakePerClub = Math.max(
    0,
    foresomeProcessingDollars - stripeWholesaleCost
  );
  const foresomeTotalRevenuePerClub = foresomeSubCost + foresomeNetTakePerClub;

  // Multi-club portfolio projection
  const proClubsCount = Math.round(clubCount * (proAdoptionPct / 100));
  const freeClubsCount = Math.max(0, clubCount - proClubsCount);
  const portfolioGmv = grossSeasonCollected * clubCount;
  const portfolioSubRevenue = proClubsCount * (proMonthly * seasonMonths);
  const portfolioNetFeeRevenue =
    proClubsCount * (grossSeasonCollected * ((5.5 - 2.9) / 100)) +
    freeClubsCount * (grossSeasonCollected * ((6.5 - 2.9) / 100));
  const portfolioTotalNetRevenue = portfolioSubRevenue + portfolioNetFeeRevenue;

  const exportForecastCsv = () => {
    downloadCsv('foresome-season-forecast.csv', [
      {
        preset: activePreset,
        members,
        dues_per_member: duesPerMember,
        events_per_season: eventsCount,
        players_per_event: playersPerEvent,
        total_rounds: totalRounds,
        entry_fee: entryFee,
        addons_per_player: addonsPerPlayer,
        sponsors_per_event: sponsorsPerEvent,
        donations_per_event: donationsPerEvent,
        gross_season_collected: Math.round(grossSeasonCollected),
        foresome_plan: planTier,
        pass_fee_to_player: passFeeToPlayer,
        foresome_club_software_cost: Math.round(foresomeClubOutOfPocket),
        club_net_payout: Math.round(foresomeNetToClub),
        legacy_software_cost_today: Math.round(legacyTotalCostWhenAbsorbed),
        estimated_club_savings: Math.round(clubSeasonSavings),
        foresome_net_platform_revenue_per_club: Math.round(foresomeTotalRevenuePerClub),
      },
    ]);
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="fs-card" style={{ borderColor: 'rgba(214, 178, 101, 0.4)', background: 'linear-gradient(180deg, rgba(22, 48, 34, 0.72) 0%, rgba(10, 24, 16, 0.85) 100%)' }}>
        <div className="fs-card-row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div className="fs-eyebrow" style={{ color: '#d6b265' }}>
              SEASON REVENUE &amp; SOFTWARE COST ESTIMATOR
            </div>
            <div className="fs-card-title" style={{ fontSize: 18, marginTop: 2 }}>
              What Your Club Collects vs. What Software Costs Today
            </div>
            <div className="fs-card-meta">
              Adjust your league, community, or tournament numbers below to forecast gross collection, club net payout, and ForeSome monetization.
            </div>
          </div>
          <button type="button" className="fs-small-btn ghost" onClick={exportForecastCsv}>
            📥 CSV
          </button>
        </div>

        {/* Preset Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 14 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              style={{
                textAlign: 'left',
                padding: '9px 11px',
                borderRadius: 10,
                border: activePreset === p.id ? '1px solid #d6b265' : '1px solid rgba(255,255,255,0.1)',
                background: activePreset === p.id ? 'rgba(214, 178, 101, 0.16)' : 'rgba(7, 20, 13, 0.55)',
                color: '#f3f5f1',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 12, color: activePreset === p.id ? '#d6b265' : '#f3f5f1' }}>
                {p.label}
              </div>
              <div style={{ fontSize: 10.5, color: '#9ab0a1', marginTop: 2 }}>{p.desc}</div>
            </button>
          ))}
        </div>

        {/* Top Headline Summary Cards */}
        <div className="cm-facts" style={{ marginBottom: 14 }}>
          <div>
            <b style={{ color: '#f3f5f1' }}>{fmtUsd(grossSeasonCollected)}</b>
            <span>Season Collected</span>
          </div>
          <div>
            <b style={{ color: '#2ecc71' }}>{fmtUsd(foresomeNetToClub)}</b>
            <span>Your Club Keeps</span>
          </div>
          <div>
            <b style={{ color: '#d6b265' }}>{fmtUsd(foresomeClubOutOfPocket)}</b>
            <span>ForeSome Cost to Club</span>
          </div>
          <div>
            <b style={{ color: '#58d68d' }}>+{fmtUsd(clubSeasonSavings)}</b>
            <span>Saved vs. Legacy</span>
          </div>
        </div>

        {/* Sliders: What Your Club Collects in a Season */}
        <div className="fs-section-title" style={{ marginTop: 6 }}>
          1. Estimate What Your Club Collects in a Season
        </div>

        <div className="cm-row2">
          <label className="fs-field">
            <span>Active Members: <b style={{ color: '#d6b265' }}>{members}</b></span>
            <input
              type="range"
              min="0"
              max="400"
              step="4"
              value={members}
              onChange={(e) => setMembers(Number(e.target.value))}
            />
          </label>
          <label className="fs-field">
            <span>Season Dues / Member: <b style={{ color: '#d6b265' }}>${duesPerMember}</b></span>
            <input
              type="range"
              min="0"
              max="350"
              step="5"
              value={duesPerMember}
              onChange={(e) => setDuesPerMember(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="cm-row2">
          <label className="fs-field">
            <span>Events in Season: <b style={{ color: '#d6b265' }}>{eventsCount}</b></span>
            <input
              type="range"
              min="1"
              max="40"
              step="1"
              value={eventsCount}
              onChange={(e) => setEventsCount(Number(e.target.value))}
            />
          </label>
          <label className="fs-field">
            <span>Golfers / Event: <b style={{ color: '#d6b265' }}>{playersPerEvent}</b> ({totalRounds} rounds)</span>
            <input
              type="range"
              min="4"
              max="144"
              step="4"
              value={playersPerEvent}
              onChange={(e) => setPlayersPerEvent(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="cm-row2">
          <label className="fs-field">
            <span>Entry Fee / Golfer: <b style={{ color: '#d6b265' }}>${entryFee}</b></span>
            <input
              type="range"
              min="0"
              max="250"
              step="5"
              value={entryFee}
              onChange={(e) => setEntryFee(Number(e.target.value))}
            />
          </label>
          <label className="fs-field">
            <span>Add-Ons &amp; Concessions / Golfer: <b style={{ color: '#d6b265' }}>${addonsPerPlayer}</b></span>
            <input
              type="range"
              min="0"
              max="100"
              step="2"
              value={addonsPerPlayer}
              onChange={(e) => setAddonsPerPlayer(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="cm-row2">
          <label className="fs-field">
            <span>Sponsors / Event: <b style={{ color: '#d6b265' }}>${sponsorsPerEvent}</b></span>
            <input
              type="range"
              min="0"
              max="10000"
              step="100"
              value={sponsorsPerEvent}
              onChange={(e) => setSponsorsPerEvent(Number(e.target.value))}
            />
          </label>
          <label className="fs-field">
            <span>Charity Donations / Event: <b style={{ color: '#d6b265' }}>${donationsPerEvent}</b></span>
            <input
              type="range"
              min="0"
              max="10000"
              step="100"
              value={donationsPerEvent}
              onChange={(e) => setDonationsPerEvent(Number(e.target.value))}
            />
          </label>
        </div>

        {/* Collection Line-Item Bar */}
        <div
          style={{
            background: 'rgba(7, 20, 13, 0.65)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: '10px 12px',
            marginTop: 8,
            marginBottom: 14,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>🎟️ Event Entries ({totalRounds} rounds × ${entryFee})</span>
            <b>{fmtUsd(entriesCollected)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>🪪 Membership Dues ({members} members × ${duesPerMember})</span>
            <b>{fmtUsd(duesCollected)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>🍔 Add-Ons, Skins &amp; Turn Concessions ({totalRounds} × ${addonsPerPlayer})</span>
            <b>{fmtUsd(addonsCollected)}</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>🤝 Event &amp; Season Sponsors ({eventsCount} × ${sponsorsPerEvent})</span>
            <b>{fmtUsd(sponsorsCollected)}</b>
          </div>
          {donationsCollected > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>🎗️ Charity Donations ({eventsCount} × ${donationsPerEvent})</span>
              <b>{fmtUsd(donationsCollected)}</b>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '1px solid rgba(214, 178, 101, 0.3)',
              paddingTop: 6,
              marginTop: 4,
              color: '#d6b265',
              fontSize: 13,
            }}
          >
            <b>Total Season Gross Collected</b>
            <b>{fmtUsd(grossSeasonCollected)}</b>
          </div>
        </div>

        {/* 2. Software Cost Today vs. ForeSome */}
        <div className="fs-section-title">
          2. What the Software to Run It Costs Today
        </div>

        <div className="fs-seg" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className={planTier === 'free' ? 'on' : ''}
            onClick={() => setPlanTier('free')}
          >
            ⛳ Community Free ($0/mo · 6.5% fee)
          </button>
          <button
            type="button"
            className={planTier === 'pro' ? 'on' : ''}
            onClick={() => setPlanTier('pro')}
          >
            🌟 Community Pro (${proMonthly}/mo · 5.5% fee)
          </button>
        </div>

        <label className="fs-check" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={passFeeToPlayer}
            onChange={(e) => setPassFeeToPlayer(e.target.checked)}
          />
          <span>
            <b>Pass transaction fee to player at checkout</b> (+${((entryFee * foresomeFeePct) / 100 + 0.3).toFixed(2)} on a ${entryFee} entry — your club keeps <b>100%</b> of event &amp; dues revenue)
          </span>
        </label>

        <div className="cm-row2">
          <label className="fs-field">
            <span>Season Length: <b>{seasonMonths} mos</b></span>
            <input
              type="range"
              min="1"
              max="12"
              step="1"
              value={seasonMonths}
              onChange={(e) => setSeasonMonths(Number(e.target.value))}
            />
          </label>
          {planTier === 'pro' ? (
            <label className="fs-field">
              <span>ForeSome Pro Plan: <b>${proMonthly}/mo</b> ($49–$79)</span>
              <input
                type="range"
                min="49"
                max="79"
                step="5"
                value={proMonthly}
                onChange={(e) => setProMonthly(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className="fs-field">
              <span>Competitor Software Today: <b>${legacyMonthly}/mo</b></span>
              <input
                type="range"
                min="79"
                max="299"
                step="10"
                value={legacyMonthly}
                onChange={(e) => setLegacyMonthly(Number(e.target.value))}
              />
            </label>
          )}
        </div>

        {/* Side-by-Side Cost Comparison Table */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginTop: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(232, 138, 138, 0.08)',
              border: '1px solid rgba(232, 138, 138, 0.28)',
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#e88a8a', letterSpacing: '0.08em' }}>
              OTHER GOLF SOFTWARE TODAY
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f3f5f1', margin: '4px 0' }}>
              {fmtUsd(legacyTotalCostWhenAbsorbed)}
              <span style={{ fontSize: 11, fontWeight: 500, color: '#9ab0a1' }}> / season</span>
            </div>
            <div style={{ fontSize: 11, color: '#9ab0a1', lineHeight: 1.45 }}>
              • ${legacyMonthly}/mo subscription ({fmtUsd(legacySubCost)})<br />
              • {legacyFeePct}% + $0.30 fees ({fmtUsd(legacyProcessingDollars)})<br />
              • Club nets: <b>{fmtUsd(grossSeasonCollected - legacyTotalCostWhenAbsorbed)}</b>
            </div>
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(46, 204, 113, 0.11)',
              border: '1px solid rgba(46, 204, 113, 0.45)',
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#2ecc71', letterSpacing: '0.08em' }}>
              FORESOME ({planTier === 'pro' ? 'PRO' : 'FREE AT PARTNER COURSE'})
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#2ecc71', margin: '4px 0' }}>
              {fmtUsd(foresomeClubOutOfPocket)}
              <span style={{ fontSize: 11, fontWeight: 500, color: '#9ab0a1' }}> / season</span>
            </div>
            <div style={{ fontSize: 11, color: '#c8d6cd', lineHeight: 1.45 }}>
              • {planTier === 'pro' ? `$${proMonthly}/mo × ${seasonMonths} mos (${fmtUsd(foresomeSubCost)})` : '$0/mo software subscription'}<br />
              • {passFeeToPlayer ? `Player pays ${foresomeFeePct}% fee at checkout` : `Club absorbs ${fmtUsd(foresomeProcessingDollars)} fees`}<br />
              • Club nets: <b style={{ color: '#2ecc71' }}>{fmtUsd(foresomeNetToClub)}</b>
            </div>
          </div>
        </div>

        {/* 3. ForeSome Platform Monetization Forecast (For Admin / Business Forecasting) */}
        {showPlatformScale && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div className="fs-section-title" style={{ marginTop: 0 }}>
              3. ForeSome Platform Monetization Forecast
            </div>
            <p className="fs-footnote" style={{ marginTop: 0 }}>
              Model how much ForeSome earns across your active communities &amp; courses (Subscriptions + Net Platform Fee after Stripe&apos;s 2.9% + $0.30).
            </p>
            <div className="cm-row2">
              <label className="fs-field">
                <span>Active Communities / Leagues: <b style={{ color: '#d6b265' }}>{clubCount}</b></span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={clubCount}
                  onChange={(e) => setClubCount(Number(e.target.value))}
                />
              </label>
              <label className="fs-field">
                <span>Communities on Pro Plan: <b style={{ color: '#d6b265' }}>{proAdoptionPct}%</b> ({proClubsCount} Pro / {freeClubsCount} Free)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={proAdoptionPct}
                  onChange={(e) => setProAdoptionPct(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="cm-facts" style={{ marginTop: 6 }}>
              <div>
                <b>{fmtUsd(portfolioGmv)}</b>
                <span>Total Season GMV</span>
              </div>
              <div>
                <b>{fmtUsd(portfolioSubRevenue)}</b>
                <span>Pro Subscriptions</span>
              </div>
              <div>
                <b>{fmtUsd(portfolioNetFeeRevenue)}</b>
                <span>Net Transaction Margin</span>
              </div>
              <div>
                <b style={{ color: '#d6b265' }}>{fmtUsd(portfolioTotalNetRevenue)}</b>
                <span>ForeSome Net Revenue</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

