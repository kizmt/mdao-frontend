import { useCallback, useState, useEffect, useMemo } from 'react';
import {
  ActionIcon,
  Card,
  Stack,
  Text,
  SegmentedControl,
  TextInput,
  Grid,
  GridCol,
  Button,
  Tooltip,
  NativeSelect,
  HoverCard,
  Group,
} from '@mantine/core';
import numeral from 'numeral';
import { Icon12Hours, IconWallet, IconInfoCircle } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConditionalMarketOrderBook } from './ConditionalMarketOrderBook';
import { useAutocrat } from '../../contexts/AutocratContext';
import { calculateTWAP, getLastObservedAndSlot } from '../../lib/openbookTwap';
import { BASE_FORMAT, NUMERAL_FORMAT } from '../../lib/constants';
import { useProposal } from '@/contexts/ProposalContext';
import { useExplorerConfiguration } from '@/hooks/useExplorerConfiguration';
import MarketTitle from './MarketTitle';
import DisableNumberInputScroll from '../Utilities/DisableNumberInputScroll';
import { useBalance } from '../../hooks/useBalance';
import { useProvider } from '@/hooks/useProvider';
import { useProposalMarkets } from '@/contexts/ProposalMarketsContext';

type Props = {
  asks: any[][];
  bids: any[][];
  spreadString: string;
  lastSlotUpdated: number;
  isPassMarket: boolean;
};

export function ConditionalMarketCard({
  asks,
  bids,
  spreadString,
  lastSlotUpdated,
  isPassMarket,
}: Props) {
  const queryClient = useQueryClient();
  const { daoState } = useAutocrat();
  const { proposal, isCranking, crankMarkets } = useProposal();
  const { orderBookObject, markets, placeOrder } = useProposalMarkets();
  const provider = useProvider();
  const [orderType, setOrderType] = useState<string>('Limit');
  const [orderSide, setOrderSide] = useState<string>('Buy');
  const [amount, setAmount] = useState<number>(0);
  const [price, setPrice] = useState<string>('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [orderValue, setOrderValue] = useState<string>('0');
  const { generateExplorerLink } = useExplorerConfiguration();
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [clusterTimestamp, setClusterTimestamp] = useState<number>(0);
  const [observedTimestamp, setObservedTimestamp] = useState<number>(0);

  const { amount: baseBalance } = useBalance(
    isPassMarket
      ? markets?.baseVault.conditionalOnFinalizeTokenMint
      : markets?.baseVault.conditionalOnRevertTokenMint,
  );

  const { amount: quoteBalance } = useBalance(
    isPassMarket
      ? markets?.quoteVault.conditionalOnFinalizeTokenMint
      : markets?.quoteVault.conditionalOnRevertTokenMint,
  );

  const { data: slotData } = useQuery({
    queryKey: ['getSlot'],
    queryFn: () => provider.connection.getSlot(),
    staleTime: 30_000,
  });
  const slot = slotData ?? 0;

  if (!markets) return <></>;
  const passTwap = calculateTWAP(markets.passTwap.twapOracle);
  const failTwap = calculateTWAP(markets.failTwap.twapOracle);
  const passObservation = getLastObservedAndSlot(markets.passTwap.twapOracle);
  const failObservation = getLastObservedAndSlot(markets.failTwap.twapOracle);
  const passAggregateObservation = markets.passTwap.twapOracle.observationAggregator.toNumber();
  const failAggregateObservation = markets.failTwap.twapOracle.observationAggregator.toNumber();
  const twap = isPassMarket ? passTwap : failTwap;
  const isAskSide = orderSide === 'Sell';
  const isLimitOrder = orderType === 'Limit';

  // TODO: Review this as anything less than this fails to work
  const minMarketPrice = 10;
  // TODO: Review this number as max safe doesn't work
  const maxMarketPrice = 10000000000;

  const updateOrderValue = () => {
    if (!Number.isNaN(amount) && !Number.isNaN(+price)) {
      const _price = parseFloat((+price * amount).toString()).toFixed(2);
      setOrderValue(_price);
    } else {
      setOrderValue('0');
    }
  };

  const _orderPrice = () => {
    if (isLimitOrder) {
      if (Number(price) > 0) {
        return Number(price);
      }
      // TODO: This is not a great value or expected behavior.. We need to throw error..
      return 0;
    }
    if (orderSide === 'Sell') {
      return minMarketPrice;
    }
    return maxMarketPrice;
  };

  const priceValidator = (value: string) => {
    if (isLimitOrder) {
      if (Number(value) > 0) {
        if (isAskSide) {
          if (isPassMarket) {
            if (Number(value) <= Number(orderBookObject?.passToB.topBid)) {
              setPriceError('You will cross the books with a taker order');
              return;
            }
            setPriceError(null);
            return;
          }
          if (Number(value) <= Number(orderBookObject?.failToB.topBid)) {
            setPriceError('You will cross the books with a taker order');
            return;
          }
          setPriceError(null);
          return;
        }
        if (isPassMarket) {
          if (Number(value) >= Number(orderBookObject?.passToB.topAsk)) {
            setPriceError('You will cross the books with a taker order');
            return;
          }
          setPriceError(null);
          return;
        }
        if (Number(value) >= Number(orderBookObject?.failToB.topAsk)) {
          setPriceError('You will cross the books with a taker order');
          return;
        }
        setPriceError(null);
      } else {
        setPriceError('Enter a value greater than 0');
      }
    }
  };

  const timeSinceObservation = () => {
    const diff = clusterTimestamp - observedTimestamp;
    if (diff > 864_000) {
      return 'A long time ago';
    }
    if (diff > 86_400) {
      const _diff = diff / 86_400;
      return `${_diff.toFixed(0)}+ days ago`;
    }
    if (diff > 3_600) {
      // hours
      const _diff = diff / 3_600;
      return `${_diff.toFixed(0)}+ hours ago`;
    }
    if (diff > 60) {
      // minutes
      const _diff = diff / 60;
      return `${_diff.toFixed(0)}+ minutes ago`;
    }
    return `${diff} seconds ago`;
  };

  const lastObservedSlot = useMemo((): number => {
    if (passObservation && failObservation) {
      return isPassMarket
        ? passObservation?.lastObservationSlot.toNumber()
        : failObservation?.lastObservationSlot.toNumber();
    }
    return 0;
  }, [isPassMarket, passObservation, failObservation]);

  const failMidPrice =
    (Number(orderBookObject?.failToB.topAsk) + Number(orderBookObject?.failToB.topBid)) / 2;
  const passMidPrice =
    (Number(orderBookObject?.passToB.topAsk) + Number(orderBookObject?.passToB.topBid)) / 2;

  const setPriceFromOrderBook = (value: string) => {
    priceValidator(value);
    setPrice(value);
  };

  const maxOrderAmount = () => {
    if (isAskSide) {
      if (Number(baseBalance?.uiAmountString || 0) > 0) {
        return Number(baseBalance?.uiAmountString || 0);
      }
      return 0;
    }
    if (quoteBalance && price) {
      const _maxAmountRatio = Math.floor(Number(quoteBalance?.uiAmountString) / Number(price));
      return _maxAmountRatio;
    }
    return 0;
  };

  const amountValidator = (value: number) => {
    if (value > 0) {
      if (!isLimitOrder) {
        setAmountError(`A market order may execute at an 
        extremely ${isAskSide ? 'low' : 'high'} price
        be sure you know what you're doing`);
        return;
      }
      if (value > maxOrderAmount()) {
        setAmountError("You don't have enough funds");
      } else {
        setAmountError(null);
      }
    } else {
      setAmountError('You must enter a whole number');
    }
  };

  const changeOrderSide = (side: string) => {
    // Clear out our errors
    setPriceError(null);
    setAmountError(null);
    // Reset amount
    setAmount(0);
    setOrderValue('0');
    // Check and change values to match order type
    if (isLimitOrder) {
      // We can safely reset our price to nothing
      setPrice('');
    } else if (side === 'Buy') {
      // Sets up the market order for the largest value
      setPrice(maxMarketPrice.toString());
    } else {
      // Sets up the market order for the smallest value
      setPrice(minMarketPrice.toString());
    }
  };

  const isOrderAmountNan = () => {
    const _orderAmount = numeral(maxOrderAmount()).format(isAskSide ? BASE_FORMAT : NUMERAL_FORMAT);
    return Number.isNaN(Number(_orderAmount));
  };

  const isWinning = () => {
    if (passTwap && failTwap && daoState) {
      const fail = (failTwap * (10000 + daoState.passThresholdBps)) / 10000;
      const passWin = passTwap > fail;
      if (isPassMarket) return passWin || proposal?.account.state.passed ? '#67BD63' : 'inherit';
      return !passWin || proposal?.account.state.failed ? 'red' : 'inherit';
    }
    return 'inherit';
  };

  const handlePlaceOrder = useCallback(async () => {
    try {
      setIsPlacingOrder(true);
      await placeOrder(amount, _orderPrice(), isLimitOrder, isAskSide, isPassMarket);
    } finally {
      setIsPlacingOrder(false);
    }
  }, [placeOrder, amount, isLimitOrder, isPassMarket, isAskSide]);

  const getObservableTwap = () => {
    if (isPassMarket) {
      if (passObservation) {
        if (passMidPrice > passObservation.lastObservationValue) {
          const max_observation =
            (passObservation.lastObservationValue * (10_000 + 100)) / 10_000 + 1;
          const evaluated = Math.min(passMidPrice, max_observation);
          return evaluated;
        }
        const min_observation = (passObservation.lastObservationValue * (10_000 + 100)) / 10_000;
        const evaluated = Math.max(passMidPrice, min_observation);
        return evaluated;
      }
    } else if (failObservation) {
      if (failMidPrice > failObservation.lastObservationValue) {
        const max_observation =
          (failObservation.lastObservationValue * (10_000 + 100)) / 10_000 + 1;
        const evaluated = Math.min(failMidPrice, max_observation);
        return evaluated;
      }
      const min_observation = (failObservation.lastObservationValue * (10_000 + 100)) / 10_000;
      const evaluated = Math.max(failMidPrice, min_observation);
      return evaluated;
    }
  };

  const getTotalImpact = (): number => {
    const aggregateObservation = isPassMarket ? passAggregateObservation : failAggregateObservation;
    const twapObserved = getObservableTwap();
    if (twapObserved) {
      const _slotDiffObserved = twapObserved * (slot - lastObservedSlot);
      const newAggregate = aggregateObservation + _slotDiffObserved;
      const startSlot = proposal?.account.slotEnqueued.toNumber();
      const proposalTimeInSlots: number = lastObservedSlot - startSlot;
      const oldValue = aggregateObservation / proposalTimeInSlots;
      const newValue = newAggregate / proposalTimeInSlots;
      return (newValue - oldValue) / oldValue;
    }
    return 0;
  };

  const getClusterTimestamp = async () => {
    let _clusterTimestamp: number = 0;
    if (slot !== 0) {
      _clusterTimestamp = await queryClient.fetchQuery({
        queryKey: [`getBlockTime-${slot}`],
        queryFn: () => provider.connection.getBlockTime(slot),
        staleTime: 30_000,
      });
    }
    const _observedTimestamp = await queryClient.fetchQuery({
      queryKey: [`getBlockTime-${lastObservedSlot}`],
      queryFn: () => provider.connection.getBlockTime(lastObservedSlot),
      staleTime: 30_000,
    });
    if (_clusterTimestamp) {
      setClusterTimestamp(_clusterTimestamp);
    }
    if (_observedTimestamp) {
      setObservedTimestamp(_observedTimestamp);
    }
  };

  useEffect(() => {
    updateOrderValue();
    if (amount !== 0) amountValidator(amount);
  }, [amount]);

  useEffect(() => {
    updateOrderValue();
    if (price !== '') priceValidator(price);
  }, [price]);

  useEffect(() => {
    if ((!clusterTimestamp || clusterTimestamp === 0) && slot) {
      getClusterTimestamp();
    }
  }, [slot]);

  return (
    <Card
      withBorder
      radius="md"
      maw="26rem"
      style={{ border: `1px solid ${isWinning()}` }}
      bg="transparent"
    >
      <DisableNumberInputScroll />
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <MarketTitle isPassMarket={isPassMarket} />
          <Tooltip label="Crank the market 🐷" events={{ hover: true, focus: true, touch: false }}>
            <ActionIcon variant="subtle" loading={isCranking} onClick={() => crankMarkets()}>
              <Icon12Hours />
            </ActionIcon>
          </Tooltip>
        </Group>
        {twap ? (
          <Group justify="center" align="center">
            <Stack gap={0} pb="1rem" align="center">
              <Group gap={3} justify="center" align="center">
                <Text fw="bold" size="md">
                  ${numeral(twap).format(NUMERAL_FORMAT)}
                </Text>
                <Text size="sm">TWAP</Text>
              </Group>
              <Text size="xs">
                ${numeral(isPassMarket ? passMidPrice : failMidPrice).format(NUMERAL_FORMAT)} (mid)
              </Text>
            </Stack>
            <HoverCard position="top">
              <HoverCard.Target>
                <IconInfoCircle strokeWidth={1.3} />
              </HoverCard.Target>
              <HoverCard.Dropdown w="22rem">
                <Stack>
                  <Text>
                    The Time Weighted Average Price (TWAP) is the measure used to decide if the
                    proposal passes: if the TWAP of the pass market is{' '}
                    {daoState
                      ? `${numeral(daoState.passThresholdBps / 100).format(NUMERAL_FORMAT)}%`
                      : '???'}{' '}
                    above the fail market{' '}
                    {daoState && failTwap
                      ? `(> ${numeral(
                          (failTwap * (10000 + daoState.passThresholdBps)) / 10000,
                        ).format(NUMERAL_FORMAT)})`
                      : null}
                    , the proposal will pass once the countdown ends.
                  </Text>
                  <Text>
                    Last observed price (for TWAP calculation) $
                    {numeral(
                      isPassMarket
                        ? passObservation?.lastObservationValue
                        : failObservation?.lastObservationValue,
                    ).format(NUMERAL_FORMAT)}
                  </Text>
                  <Text size="xs">
                    Last observed at
                    <br />
                    slot{' '}
                    {isPassMarket
                      ? passObservation?.lastObservationSlot.toNumber()
                      : failObservation?.lastObservationSlot.toNumber()}{' '}
                    | {slot - lastObservedSlot} slots behind cluster
                    <br />
                    {new Date(observedTimestamp * 1000).toUTCString()} | {timeSinceObservation()}
                  </Text>
                  <Text>
                    Crank Impact{' '}
                    {(getTotalImpact() * 100).toLocaleString('fullwide', {
                      useGrouping: false,
                      maximumSignificantDigits: 20,
                    })}
                    %
                  </Text>
                  <Text c={isWinning()}>
                    Currently the{' '}
                    {passTwap! > (failTwap! * (10000 + daoState!.passThresholdBps)) / 10000
                      ? 'Pass'
                      : 'Fail'}{' '}
                    Market wins.
                  </Text>
                  <Text size="xs">
                    <a
                      href={generateExplorerLink(
                        isPassMarket
                          ? proposal?.account.openbookTwapPassMarket.toString()!
                          : proposal?.account.openbookTwapFailMarket.toString()!,
                        'account',
                      )}
                      target="blank"
                    >
                      {`See ${isPassMarket ? 'Pass' : 'Fail'} TWAP Market in explorer.`}
                    </a>
                  </Text>
                </Stack>
              </HoverCard.Dropdown>
            </HoverCard>
          </Group>
        ) : null}
        <ConditionalMarketOrderBook
          orderBookObject={orderBookObject}
          setPriceFromOrderBook={setPriceFromOrderBook}
          asks={asks}
          bids={bids}
          spreadString={spreadString}
          lastSlotUpdated={lastSlotUpdated}
        />
        <Stack>
          <SegmentedControl
            style={{ marginTop: '10px' }}
            color={isAskSide ? 'red' : 'green'}
            classNames={{
              label: 'label',
            }}
            data={['Buy', 'Sell']}
            value={orderSide}
            onChange={(e) => {
              setOrderSide(e);
              changeOrderSide(e);
            }}
            fullWidth
          />
          <NativeSelect
            style={{ marginTop: '10px' }}
            data={['Limit', 'Market']}
            value={orderType}
            onChange={(e) => {
              setOrderType(e.target.value);
              if (e.target.value === 'Market') {
                if (isAskSide) {
                  setPrice(minMarketPrice.toString());
                } else {
                  setPrice(maxMarketPrice.toString());
                }
              } else {
                setPrice('');
              }
              setPriceError(null);
              setAmountError(null);
            }}
          />
          <Grid>
            <Grid.Col span={6}>
              <TextInput
                label="Price"
                placeholder="Enter price..."
                type="number"
                w="100%"
                value={!isLimitOrder ? '' : price}
                disabled={!isLimitOrder}
                error={priceError}
                onChange={(e) => {
                  setPrice(e.target.value);
                }}
              />
            </Grid.Col>
            <Grid.Col span={6}>
              <TextInput
                label={
                  <Group justify="space-between" align="center">
                    <Text size="sm">Amount of META</Text>
                  </Group>
                }
                placeholder="Enter amount..."
                type="number"
                value={amount || ''}
                defaultValue={amount || ''}
                rightSectionWidth={70}
                rightSection={
                  <ActionIcon
                    w="80%"
                    radius="sm"
                    color="grey"
                    onClick={() => {
                      setAmount(maxOrderAmount()! ? maxOrderAmount()! : 0);
                      amountValidator(maxOrderAmount()! ? maxOrderAmount()! : 0);
                    }}
                    disabled={!isLimitOrder ? !!isOrderAmountNan() : !price}
                  >
                    <Text size="xs">
                      Max{' '}
                      {maxOrderAmount() && maxOrderAmount() < 1000
                        ? !isOrderAmountNan()
                          ? numeral(maxOrderAmount()).format(BASE_FORMAT)
                          : ''
                        : ''}
                    </Text>
                  </ActionIcon>
                }
                error={amountError}
                onChange={(e) => {
                  setAmount(Number(e.target.value));
                }}
              />
            </Grid.Col>
          </Grid>
          <Group align="center" justify="space-between">
            {baseBalance?.uiAmountString || quoteBalance?.uiAmountString ? (
              <Group gap={0}>
                <IconWallet height={12} />
                <Text size="xs">
                  {isAskSide
                    ? `${isPassMarket ? 'p' : 'f'}META ${
                        numeral(baseBalance?.uiAmountString || 0).format(BASE_FORMAT) || ''
                      }`
                    : `${isPassMarket ? 'p' : 'f'}USDC $${
                        numeral(quoteBalance?.uiAmountString || 0).format(NUMERAL_FORMAT) || ''
                      }`}
                </Text>
              </Group>
            ) : (
              <Text> </Text>
            )}
            <>
              <Text size="xs">Total Order Value ${orderValue}</Text>
            </>
          </Group>
          <Grid>
            <GridCol span={12}>
              <Button
                fullWidth
                color={isAskSide ? 'red' : 'green'}
                onClick={handlePlaceOrder}
                variant="outline"
                disabled={!amount || (isLimitOrder ? !price : false)}
                loading={isPlacingOrder}
              >
                {orderSide} {isPassMarket ? 'p' : 'f'}META
              </Button>
            </GridCol>
          </Grid>
        </Stack>
      </Stack>
    </Card>
  );
}
