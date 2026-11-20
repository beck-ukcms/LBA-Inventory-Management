/** PT and Paper catalog operations. Only this module writes catalog rows. */
const PT_GAME_TYPES = ['Daub', 'Horse Race', 'Under Seal', 'Mixed', 'Other'];
function getPTCatalog_() {
  return getRecords_('PT_Catalog');
}
function buildPTFormOptions_() {
  const options = [];
  getPTCatalog_().filter(game => game.Active === true || String(game.Active).toLowerCase() === 'true').forEach(game => {
    const forms = [normalizeFormNumber_(game.Primary_Form_Number), ...splitAlternateForms_(game.Alternate_Form_Numbers)].filter(Boolean);
    forms.forEach(form => options.push({
      gameId: String(game.PT_Game_ID),
      gameName: String(game.Game_Name),
      formNumber: form,
      label: `${game.Game_Name} (${form})`,
    }));
  });
  return options.sort((a, b) => a.gameName.localeCompare(b.gameName) || a.formNumber.localeCompare(b.formNumber));
}
function assertFormAvailable_(formNumber, excludingGameId) {
  const form = normalizeFormNumber_(formNumber);
  if (!form) throw new Error('Form Number is required.');
  const collision = getPTCatalog_().find(game => {
    if (excludingGameId && String(game.PT_Game_ID) === String(excludingGameId)) return false;
    if (!(game.Active === true || String(game.Active).toLowerCase() === 'true')) return false;
    return [normalizeFormNumber_(game.Primary_Form_Number), ...splitAlternateForms_(game.Alternate_Form_Numbers)].includes(form);
  });
  if (collision) throw new Error(`Form ${form} is already assigned to active game ${collision.Game_Name}.`);
  return form;
}
function createPTGame(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const name = normalizeText_(payload.gameName);

  if (!name) {
    throw new Error('Game Name is required.');
  }

  if (!PT_GAME_TYPES.includes(payload.gameType)) {
    throw new Error('Select a valid Game Type.');
  }

  const primary = assertFormAvailable_(payload.primaryFormNumber);
  const alternates = splitAlternateForms_(payload.alternateFormNumbers);

  if (alternates.includes(primary)) {
    throw new Error(
      'Primary Form Number cannot also appear as an alternate.'
    );
  }

  alternates.forEach((form) => {
    assertFormAvailable_(form);
  });

  const cardsPerDeal = integerOrThrow_(
    payload.cardsPerDeal,
    'Cards per Deal',
    { allowZero: false }
  );

  const dealsPerCase = integerOrThrow_(
    payload.dealsPerCase,
    'Deals per Case',
    { allowZero: false }
  );

  const pricePerCard = numberOrThrow_(
    payload.pricePerCard,
    'Price per Card'
  );

  const payoutPerDeal = numberOrThrow_(
    payload.payoutPerDeal,
    'Payout per Deal'
  );

  const manufacturerCostPerDeal = numberOrThrow_(
    payload.manufacturerCostPerDeal,
    'Manufacturer Cost per Deal'
  );

  const grossReceiptsPerDeal = cardsPerDeal * pricePerCard;
  const gamingIncomeBeforeCost = grossReceiptsPerDeal - payoutPerDeal;
  const netIncomePerDeal =
    grossReceiptsPerDeal -
    payoutPerDeal -
    manufacturerCostPerDeal;

  const id = generateId_('PT_GAME', 'PT', 4);

  appendRecord_('PT_Catalog', {
    PT_Game_ID: id,
    Game_Name: name,
    Game_Type: payload.gameType,
    Primary_Form_Number: primary,
    Alternate_Form_Numbers: alternates.join(', '),
    Active: true,
    Display_Order: integerOrThrow_(payload.displayOrder || 0, 'Display Order'),
    Cards_Per_Deal: cardsPerDeal,
    Deals_Per_Case: dealsPerCase,
    Price_Per_Card: pricePerCard,
    Payout_Per_Deal: payoutPerDeal,
    Manufacturer_Cost_Per_Deal: manufacturerCostPerDeal,
    Gross_Receipts_Per_Deal: grossReceiptsPerDeal,
    Gaming_Income_Before_Cost: gamingIncomeBeforeCost,
    Net_Income_Per_Deal: netIncomePerDeal,
    Net_Income_Per_Patron_Dollar: grossReceiptsPerDeal
      ? netIncomePerDeal / grossReceiptsPerDeal
      : 0,
    Manufacturer_Cost_Per_Patron_Dollar: grossReceiptsPerDeal
      ? manufacturerCostPerDeal / grossReceiptsPerDeal
      : 0,
    Manufacturer_Cost_Per_Case: manufacturerCostPerDeal * dealsPerCase,
    Target_On_Hand: integerOrThrow_(payload.targetOnHand || 0, 'Target On Hand'),
    Target_Bundled: integerOrThrow_(payload.targetBundled || 0, 'Target Bundled'),
    Notes: normalizeText_(payload.notes)
  });

  return {
    gameId: id,
    formNumber: primary,
    label: `${name} (${primary})`
  };
}
function addAlternateFormToGame(token, gameId, formNumber) {
  requireAdmin_(token);
  const form = assertFormAvailable_(formNumber, gameId);
  const game = getPTCatalog_().find(row => String(row.PT_Game_ID) === String(gameId));
  if (!game) throw new Error('PT game was not found.');
  const forms = splitAlternateForms_(game.Alternate_Form_Numbers);
  if (normalizeFormNumber_(game.Primary_Form_Number) === form || forms.includes(form)) return {
    gameId, formNumber: form
  };
  forms.push(form);
  updateRecordRow_('PT_Catalog', game._rowNumber, {
    Alternate_Form_Numbers: forms.join(', ')
  });
  return {
    gameId, formNumber: form, label: `${game.Game_Name} (${form})`
  };
}
function getPaperCatalog_(){
  return getRecords_('Paper_Catalog');
}
function getOrderingCatalogs(token){
  requireAdmin_(token);
  return {
    pt:buildPTFormOptions_().map(x=>Object.assign(x,{
      dealsPerCase:Number((getPTCatalog_().find(g=>String(g.PT_Game_ID)===x.gameId)||{
      }).Deals_Per_Case)||0
    })),paper:getPaperCatalog_().filter(x=>x.Active===true||String(x.Active).toLowerCase()==='true').map(x=>({
      paperId:String(x.Paper_ID),shortName:String(x.Short_Name),description:String(x.Description),packsPerCase:Number(x.Packs_Per_Case),label:`${x.Short_Name} - ${x.Description}`
    })).sort((a,b)=>a.label.localeCompare(b.label)),gameTypes:PT_GAME_TYPES
  };
}
function createPaperType(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const shortName = normalizeText_(payload.shortName).toUpperCase();
  const description = normalizeText_(payload.description);

  if (!shortName || !description) {
    throw new Error(
      'Paper Short Name and Description are required.'
    );
  }

  const existingActivePaper = getPaperCatalog_().find((paper) => {
    return (
      normalizeText_(paper.Short_Name).toUpperCase() === shortName &&
      (
        paper.Active === true ||
        String(paper.Active).toLowerCase() === 'true'
      )
    );
  });

  if (existingActivePaper) {
    throw new Error(
      `Active paper type ${shortName} already exists.`
    );
  }

  const packsPerBox = numberOrThrow_(
    payload.packsPerBox,
    'Packs per Box'
  );

  const boxesPerCase = integerOrThrow_(
    payload.boxesPerCase,
    'Boxes per Case',
    { allowZero: false }
  );

  const packsPerCase = packsPerBox * boxesPerCase;

  if (!Number.isInteger(packsPerCase)) {
    throw new Error(
      'Packs per Box × Boxes per Case must equal a whole number of packs.'
    );
  }

  const manufacturerCostPerCase = numberOrThrow_(
    payload.manufacturerCostPerCase,
    'Manufacturer Cost per Case'
  );

  const salesPricePerPack = numberOrThrow_(
    payload.salesPricePerPack,
    'Sales Price per Pack'
  );

  const manufacturerCostPerPack = packsPerCase
    ? manufacturerCostPerCase / packsPerCase
    : 0;

  const netIncomePerPack = salesPricePerPack - manufacturerCostPerPack;

  const paperId = generateId_(
    'PAPER',
    'PAPER',
    3
  );

  const recordToWrite = {
    Paper_ID: paperId,
    Short_Name: shortName,
    Description: description,
    Active: true,
    Display_Order: integerOrThrow_(payload.displayOrder || 0, 'Display Order'),
    Packs_Per_Box: packsPerBox,
    Boxes_Per_Case: boxesPerCase,
    Packs_Per_Case: packsPerCase,
    Manufacturer_Cost_Per_Case: manufacturerCostPerCase,
    Manufacturer_Cost_Per_Pack: manufacturerCostPerPack,
    Sales_Price_Per_Pack: salesPricePerPack,
    Net_Income_Per_Pack: netIncomePerPack,
    Net_Income_Per_Patron_Dollar: salesPricePerPack
      ? netIncomePerPack / salesPricePerPack
      : 0,
    Manufacturer_Cost_Per_Patron_Dollar: salesPricePerPack
      ? manufacturerCostPerPack / salesPricePerPack
      : 0,
    Target_On_Hand: integerOrThrow_(payload.targetOnHand || 0, 'Target On Hand'),
    Notes: normalizeText_(payload.notes)
  };

  const appendedRowNumber = appendRecord_(
    'Paper_Catalog',
    recordToWrite
  );

  SpreadsheetApp.flush();

  const createdPaper = getPaperCatalog_().find((paper) => {
    return String(paper.Paper_ID) === String(paperId);
  });

  if (!createdPaper) {
    throw new Error(
      `Paper type ${paperId} was written to row ${appendedRowNumber} ` +
      'but could not be read back from Paper_Catalog.'
    );
  }

  return {
    paperId: paperId,
    shortName: shortName,
    label: `${shortName} - ${description}`,
    appendedRowNumber: appendedRowNumber,
    createdPaper: createdPaper
  };
}

function getCatalogMaintenanceData(token) {
  requireAdmin_(token);
  return {
    pt: getPTCatalog_().map((g) => ({
      gameId:String(g.PT_Game_ID), gameName:String(g.Game_Name), gameType:String(g.Game_Type),
      primaryFormNumber:String(g.Primary_Form_Number), alternateFormNumbers:String(g.Alternate_Form_Numbers || ''),
      active:isActiveCatalogRecord_(g), displayOrder:Number(g.Display_Order||0), cardsPerDeal:Number(g.Cards_Per_Deal||0),
      dealsPerCase:Number(g.Deals_Per_Case||0), pricePerCard:Number(g.Price_Per_Card||0), payoutPerDeal:Number(g.Payout_Per_Deal||0),
      manufacturerCostPerDeal:Number(g.Manufacturer_Cost_Per_Deal||0), targetOnHand:Number(g.Target_On_Hand||0),
      targetBundled:Number(g.Target_Bundled||0), notes:String(g.Notes||''), label:`${g.Game_Name} (${g.Primary_Form_Number})`
    })),
    paper: getPaperCatalog_().map((p) => ({
      paperId:String(p.Paper_ID), shortName:String(p.Short_Name), description:String(p.Description), active:isActiveCatalogRecord_(p),
      displayOrder:Number(p.Display_Order||0), packsPerBox:Number(p.Packs_Per_Box||0), boxesPerCase:Number(p.Boxes_Per_Case||0),
      manufacturerCostPerCase:Number(p.Manufacturer_Cost_Per_Case||0), salesPricePerPack:Number(p.Sales_Price_Per_Pack||0),
      targetOnHand:Number(p.Target_On_Hand||0), notes:String(p.Notes||''), label:`${p.Short_Name} - ${p.Description}`
    })), gameTypes: PT_GAME_TYPES
  };
}

function updatePTGame(token, payload) {
  requireAdmin_(token); payload=payload||{};
  const game=getPTCatalog_().find(g=>String(g.PT_Game_ID)===String(payload.gameId));
  if(!game) throw new Error('PT game was not found.');
  const primary=assertFormAvailable_(payload.primaryFormNumber,game.PT_Game_ID);
  const alts=splitAlternateForms_(payload.alternateFormNumbers); alts.forEach(f=>assertFormAvailable_(f,game.PT_Game_ID));
  const cards=integerOrThrow_(payload.cardsPerDeal,'Cards per Deal',{allowZero:false});
  const deals=integerOrThrow_(payload.dealsPerCase,'Deals per Case',{allowZero:false});
  const price=numberOrThrow_(payload.pricePerCard,'Price per Card'); const payout=numberOrThrow_(payload.payoutPerDeal,'Payout per Deal');
  const cost=numberOrThrow_(payload.manufacturerCostPerDeal,'Manufacturer Cost per Deal'); const gross=cards*price; const net=gross-payout-cost;
  updateRecordRow_('PT_Catalog',game._rowNumber,{Game_Name:normalizeText_(payload.gameName),Game_Type:payload.gameType,Primary_Form_Number:primary,
    Alternate_Form_Numbers:alts.join(', '),Active:Boolean(payload.active),Display_Order:integerOrThrow_(payload.displayOrder,'Display Order'),
    Cards_Per_Deal:cards,Deals_Per_Case:deals,Price_Per_Card:price,Payout_Per_Deal:payout,Manufacturer_Cost_Per_Deal:cost,
    Gross_Receipts_Per_Deal:gross,Gaming_Income_Before_Cost:gross-payout,Net_Income_Per_Deal:net,
    Net_Income_Per_Patron_Dollar:gross?net/gross:0,Manufacturer_Cost_Per_Patron_Dollar:gross?cost/gross:0,
    Manufacturer_Cost_Per_Case:cost*deals,Target_On_Hand:integerOrThrow_(payload.targetOnHand,'Target On Hand'),
    Target_Bundled:integerOrThrow_(payload.targetBundled,'Target Bundled'),Notes:normalizeText_(payload.notes)});
  return {ok:true};
}

function updatePaperType(token,payload){
  requireAdmin_(token); payload=payload||{}; const paper=getPaperCatalog_().find(p=>String(p.Paper_ID)===String(payload.paperId));
  if(!paper) throw new Error('Paper type was not found.');
  const ppb=numberOrThrow_(payload.packsPerBox,'Packs per Box'); const bpc=integerOrThrow_(payload.boxesPerCase,'Boxes per Case',{allowZero:false});
  const ppc=ppb*bpc; if(!Number.isInteger(ppc)) throw new Error('Packs per case must be a whole number.');
  const cost=numberOrThrow_(payload.manufacturerCostPerCase,'Manufacturer Cost per Case'); const price=numberOrThrow_(payload.salesPricePerPack,'Sales Price per Pack');
  const cpp=ppc?cost/ppc:0; const net=price-cpp;
  updateRecordRow_('Paper_Catalog',paper._rowNumber,{Short_Name:normalizeText_(payload.shortName).toUpperCase(),Description:normalizeText_(payload.description),
    Active:Boolean(payload.active),Display_Order:integerOrThrow_(payload.displayOrder,'Display Order'),Packs_Per_Box:ppb,Boxes_Per_Case:bpc,Packs_Per_Case:ppc,
    Manufacturer_Cost_Per_Case:cost,Manufacturer_Cost_Per_Pack:cpp,Sales_Price_Per_Pack:price,Net_Income_Per_Pack:net,
    Net_Income_Per_Patron_Dollar:price?net/price:0,Manufacturer_Cost_Per_Patron_Dollar:price?cpp/price:0,
    Target_On_Hand:integerOrThrow_(payload.targetOnHand,'Target On Hand'),Notes:normalizeText_(payload.notes)}); return {ok:true};
}
