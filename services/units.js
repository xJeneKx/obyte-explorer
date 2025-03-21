/*jslint node: true */
'use strict';

var db = require('ocore/db.js');
var storage = require('ocore/storage.js');
var async = require('async');
var constants = require("ocore/constants.js");
const getAssetNameAndDecimals = require('../api/getAssetNameAndDecimals');

async function getLastUnits() {
	const nodes = [];
	const edges = {};

	const rows = await db.query("SELECT parenthoods.child_unit, parenthoods.parent_unit, units.ROWID, units.is_on_main_chain, units.is_stable, units.best_parent_unit, units.sequence \n\
		FROM parenthoods, units WHERE parenthoods.child_unit IN \n\
		(SELECT unit FROM units ORDER BY ROWID DESC LIMIT 0, 100) and units.unit=parenthoods.child_unit ORDER BY parenthoods.ROWID DESC");

	rows.forEach(row => {
		nodes.push({
			data: {unit: row.child_unit, unit_s: row.child_unit.substr(0, 7) + '...'},
			rowid: row.rowid,
			is_on_main_chain: row.is_on_main_chain,
			is_stable: row.is_stable,
			sequence: row.sequence
		});

		edges[row.child_unit + '_' + row.parent_unit] = {
			data: {
				source: row.child_unit,
				target: row.parent_unit
			},
			best_parent_unit: row.parent_unit == row.best_parent_unit
		};
	});
	
	return { nodes, edges };
}

async function getUnitsBeforeRowId(rowid, limit) {
	const nodes = [];
	const edges = {};
	const units = [];

	const unitRows = await db.query("SELECT ROWID, unit, is_on_main_chain, is_stable, sequence FROM units WHERE ROWID < ? ORDER BY ROWID DESC LIMIT 0, ?", [rowid, limit]);

	unitRows.forEach(row => {
		nodes.push({
			data: { unit: row.unit, unit_s: row.unit.substr(0, 7) + '...' },
			rowid: row.rowid,
			is_on_main_chain: row.is_on_main_chain,
			is_stable: row.is_stable,
			sequence: row.sequence
		});

		units.push(row.unit);
	});
	
	if (units.length) {
		const edgeRows = await db.query("SELECT parenthoods.child_unit, parenthoods.parent_unit, units.ROWID, units.is_on_main_chain, units.is_stable, units.best_parent_unit \n\
		 FROM parenthoods, units WHERE \n\
		 (parenthoods.child_unit IN (?) OR parenthoods.parent_unit IN (?))  \n\
		 AND units.unit=parenthoods.child_unit ORDER BY parenthoods.ROWID DESC", [units, units]);

		edgeRows.forEach(function(row) {
			edges[row.child_unit + '_' + row.parent_unit] = {
				data: {
					source: row.child_unit,
					target: row.parent_unit
				},
				best_parent_unit: row.parent_unit == row.best_parent_unit
			};
		});
	}

	return { nodes, edges };
}

async function getUnitsAfterRowId(rowid, limit) {
	const units = [];
	const edges = {};
	let nodes = [];

	const unitRows = await db.query("SELECT ROWID, unit, is_on_main_chain, is_stable, sequence FROM units WHERE ROWID > ? ORDER BY ROWID ASC LIMIT 0, ?", [rowid, limit]);

	unitRows.forEach((row) => {
		nodes.push({
			data: {unit: row.unit, unit_s: row.unit.substr(0, 7) + '...'},
			rowid: row.rowid,
			is_on_main_chain: row.is_on_main_chain,
			is_stable: row.is_stable,
			sequence: row.sequence
		});
		units.push(row.unit);
	});

	if (units.length) {
		const edgeRows = await db.query("SELECT parenthoods.child_unit, parenthoods.parent_unit, units.ROWID, units.is_on_main_chain, units.is_stable, units.best_parent_unit \n\
		 FROM parenthoods, units WHERE \n\
		 (parenthoods.child_unit IN (?) OR parenthoods.parent_unit IN (?))  \n\
		 AND units.unit=parenthoods.child_unit ORDER BY parenthoods.ROWID DESC", [units, units]);

		edgeRows.forEach(row => {
			edges[row.child_unit + '_' + row.parent_unit] = {
				data: {
					source: row.child_unit,
					target: row.parent_unit
				},
				best_parent_unit: row.parent_unit == row.best_parent_unit
			};
		});

		nodes = nodes.sort((a, b) => {
			if (a.rowid < b.rowid) {
				return 1;
			}
			if (a.rowid > b.rowid) {
				return -1;
			}
			return 0;
		});
	}
	
	return { nodes, edges };
}

async function getParentsAndChildren(unit) {
	const parents = [];
	const children = [];

	const rows = await db.query(
		"SELECT child_unit, parent_unit \n\
		FROM parenthoods \n\
		WHERE child_unit = ? or parent_unit = ? \n\
		ORDER BY parent_unit",
		[unit, unit]);

	rows.forEach(function(row) {
		if (row.child_unit === unit) {
			parents.push(row.parent_unit);
		} else {
			children.push(row.child_unit);
		}
	});

	return { parents, children };
}

async function getTransfersInfo(unit) {
	const rows = await db.query("SELECT outputs.output_index, outputs.address, outputs.unit, outputs.amount, outputs.asset FROM inputs, outputs \n\
		WHERE inputs.unit = ? AND inputs.type = 'transfer' AND outputs.output_index = inputs.src_output_index \n\
		AND outputs.unit = inputs.src_unit AND outputs.message_index = inputs.src_message_index", [unit]);

	const transfersInfo = {};
	rows.forEach(function (row) {
		transfersInfo[row.unit + '_' + row.output_index + '_' + row.asset] = {
			address: row.address,
			unit: row.unit,
			amount: row.amount,
		}
	});

	return transfersInfo;
}

async function getSpentOutputs(unit) {
	const rows = await db.query("SELECT outputs.output_id, inputs.unit FROM outputs, inputs \n\
		WHERE outputs.unit = ? AND is_spent = 1 AND inputs.src_unit = outputs.unit AND inputs.src_message_index = outputs.message_index \n\
		AND inputs.src_output_index = outputs.output_index", [unit]);

	const spentOutputs = {};
	rows.forEach(function (row) {
		spentOutputs[row.output_id] = row.unit;
	});

	return spentOutputs;
}

async function getUnitOutputs(unit) {
	const outputsSpent = await getSpentOutputs(unit);
	const unitOutputs = {};
	const rows = await db.query("SELECT output_id, address, amount, asset, denomination, is_spent FROM outputs WHERE unit = ? ORDER BY output_index", [unit]);

	rows.forEach(function (row) {
		if (!unitOutputs[row.asset]) unitOutputs[row.asset] = [];

		if (outputsSpent[row.output_id]) {
			row.spent = outputsSpent[row.output_id];
		} else {
			row.spent = false;
		}

		unitOutputs[row.asset].push(row);
	});

	return unitOutputs;
}

async function getUnitCommissions(unit) {
	const assocCommissions = { headers: {}, witnessing: {} };

	const rows = await db.query(`SELECT type, address, from_main_chain_index, to_main_chain_index FROM inputs
 						WHERE unit = ? AND (type = 'headers_commission' OR type = 'witnessing')`, [unit]);

	if (rows.length) {
		for (let row of rows) {
			let tableName, objectName;

			if (row.type === 'headers_commission') {
				tableName = 'headers_commission_outputs';
				objectName = 'headers';
			} else if (row.type === 'witnessing') {
				tableName = 'witnessing_outputs';
				objectName = 'witnessing';
			}

			if (tableName) {
				const rowsCommissionOutputs = await db.query(`SELECT SUM(amount) AS sum FROM ${tableName} WHERE address = ?
 						AND main_chain_index >= ? AND main_chain_index <= ? ORDER BY main_chain_index`,
					[row.address, row.from_main_chain_index, row.to_main_chain_index]);

				assocCommissions[objectName][row.from_main_chain_index + '_' + row.to_main_chain_index] = {
					address: row.address,
					from_mci: row.from_main_chain_index,
					to_mci: row.to_main_chain_index,
					sum: rowsCommissionOutputs[0].sum
				};
			}
		}
	}

	return assocCommissions;
}

async function setDefinitionInAuthors(unit, objJoint) {
	for (const key in objJoint.unit.authors) {
		const rowUnitAuthors = await db.query("SELECT * FROM unit_authors WHERE unit = ? AND address = ? AND definition_chash IS NOT NULL", [unit, objJoint.unit.authors[key].address]);

		if (rowUnitAuthors.length) {
			const rowDefinitions = await db.query("SELECT * FROM definitions WHERE definition_chash = ?", [rowUnitAuthors[0].definition_chash]);

			if (rowDefinitions) {
				objJoint.unit.authors[key].definition = rowDefinitions[0].definition;
			} else {
				objJoint.unit.authors[key].definition = false;
			}
		} else {
			objJoint.unit.authors[key].definition = false;
		}
	}

	return objJoint;
}

async function getUnitSequence(unit) {
	const rows = await db.query('SELECT sequence FROM units WHERE unit = ?', [unit]);

	return rows[0].sequence;
}

async function getAaResponses(unit) {
	const rows = await db.query('SELECT aa_address, response,bounced, response_unit FROM aa_responses WHERE trigger_unit = ?', [unit]);

	return rows[0] ? rows : null;
}

async function getTriggerUnit(unit) {
	const rows = await db.query('SELECT trigger_unit FROM aa_responses WHERE response_unit = ?', [unit]);

	return rows[0] ? rows[0].trigger_unit : null;
}

function getConfirmationDelays(objJoint){
	return new Promise((resolve)=>{
		db.query("SELECT unit FROM units WHERE is_on_main_chain=1 AND main_chain_index=?",[objJoint.unit.main_chain_index],
			function(rows){
				goDownMainChainToDetermineConfirmationTimes(rows[0].unit, null,  [], null,
					function(fullConfirmationTime, lightConfirmationTime) {
						var full_node_confirmation_delay = fullConfirmationTime ? fullConfirmationTime - objJoint.unit.timestamp : null;
						var light_node_confirmation_delay = lightConfirmationTime ? lightConfirmationTime - objJoint.unit.timestamp : null;
						return resolve({full_node_confirmation_delay, light_node_confirmation_delay});
					});
			});
	});
}


function getWitnessesForUnit(unit){
	return new Promise((resolve)=>{
		storage.readWitnesses(db, unit, function(arrWitnesses){
			resolve(arrWitnesses);
		});
	});
}

function findUnitWhereUnitBecameStable(unit){
	return new Promise((resolve)=>{
		db.query("SELECT unit, main_chain_index,\n\
		CASE timestamp \n\
			WHEN 0 THEN "+ db.getUnixTimestamp("units.creation_date")+" ELSE timestamp \n\
		END timestamp \n\
		FROM units WHERE last_ball_unit=? ORDER BY main_chain_index DESC LIMIT 1",[unit], async function(rows){
			if (rows[0])
				return resolve(rows[0]);
			else {
				var next_mc_unit= await goDownMainChain(unit);
				if (next_mc_unit)
					return findUnitWhereUnitBecameStable(next_mc_unit.unit).then(resolve);
				else
					return resolve(false);
			}
		});
	})
}

function goDownMainChain(unit){
	return new Promise((resolve)=>{
		db.query("SELECT unit,\n\
			CASE timestamp \n\
				WHEN 0 THEN "+ db.getUnixTimestamp("units.creation_date")+" ELSE timestamp \n\
			END timestamp FROM units \n\
		WHERE best_parent_unit=? AND is_on_main_chain=1",[unit],
			function(rows){
				return resolve(rows[0] ? { unit: rows[0].unit, timestamp: rows[0].timestamp } : null);
			});
	});
}

async function goDownMainChainToDetermineConfirmationTimes(parent, arrWitnesses, arrFoundWitnesses, fullConfirmationTime, handle) {
	if (!fullConfirmationTime){
		var objStabilizingUnit = await findUnitWhereUnitBecameStable(parent);
		if (!objStabilizingUnit)
			return handle();
		fullConfirmationTime = objStabilizingUnit.timestamp;
		arrWitnesses = await getWitnessesForUnit(objStabilizingUnit.unit);
		parent = objStabilizingUnit.unit;
	}

	db.query("SELECT unit,\n\
	CASE timestamp \n\
		WHEN 0 THEN "+ db.getUnixTimestamp("units.creation_date")+" ELSE timestamp \n\
	END timestamp, \n\
	unit_authors.address,main_chain_index FROM units \n\
	CROSS JOIN unit_authors USING(unit) WHERE best_parent_unit=? AND is_on_main_chain=1", [parent],
		function(rows){
			async.each(rows,
				function(row, cb) {
					if (row.main_chain_index){
						if (arrWitnesses.indexOf(row.address) >= 0 && arrFoundWitnesses.indexOf(row.address) === -1)
							arrFoundWitnesses.push(row.address);
					}
					return cb();
				},
				function(){
					if (!rows[0])
						return handle(fullConfirmationTime)
					if (arrFoundWitnesses.length >= constants.MAJORITY_OF_WITNESSES){
						return handle(fullConfirmationTime, rows[0].timestamp);
					}
					else
						goDownMainChainToDetermineConfirmationTimes(rows[0].unit, arrWitnesses, arrFoundWitnesses, fullConfirmationTime, handle);
				}
			);
		});
}

async function setAssetNameAndDecimalsInMessages(messages) {
	if (!messages || messages.length === 0) {
		return [];
	}
	
	for(let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.app === 'payment' && m.payload && m.payload.asset) {
			const objResult = await getAssetNameAndDecimals(m.payload.asset);
			if (objResult) {
				messages[i].payload.assetName = objResult.name;
				messages[i].payload.assetDecimals = objResult.decimals;
			}
		}
	}
	return messages;
}

async function checkIsAsset(unit) {
	const rows = await db.query("SELECT unit FROM assets WHERE unit = ?", [unit]);

	return !!rows.length;
}

async function getInfoOnUnit(unit) {
	return new Promise(async (resolve) => {
		const rows = await db.query('SELECT main_chain_index,latest_included_mc_index,level,witnessed_level,is_stable,tps_fee,actual_tps_fee,burn_fee,oversize_fee FROM units WHERE unit = ?', [unit]);

		if (!rows.length) {
			resolve(null);
		}

		const unitProps = rows[0];

		storage.readJoint(db, unit, {
			ifFound: async function (objJoint) {
				const objParentsAndChildren = await getParentsAndChildren(unit);
				const transfersInfo = await getTransfersInfo(unit)
				const unitOutputs = await getUnitOutputs(unit);
				const assocCommissions = await getUnitCommissions(unit);

				objJoint = await setDefinitionInAuthors(unit, objJoint);

				const sequence = await getUnitSequence(unit);
				const arrAaResponses = await getAaResponses(unit);
				const trigger_unit = await getTriggerUnit(unit);
				const messages = await setAssetNameAndDecimalsInMessages(objJoint.unit.messages);
				const isAsset = await checkIsAsset(unit);

				const objInfo = {
					unit: unit,
					sequence: sequence,
					child: objParentsAndChildren.children,
					parents: objParentsAndChildren.parents,
					authors: objJoint.unit.authors,
					headers_commission: objJoint.unit.headers_commission,
					payload_commission: objJoint.unit.payload_commission,
					main_chain_index: unitProps.main_chain_index,
					latest_included_mc_index: unitProps.latest_included_mc_index,
					level: unitProps.level,
					tps_fee: unitProps.tps_fee,
					actual_tps_fee: unitProps.actual_tps_fee,
					burn_fee: unitProps.burn_fee,
					oversize_fee: unitProps.oversize_fee,
					witnessed_level: unitProps.witnessed_level,
					is_stable: unitProps.is_stable,
					last_ball_unit: objJoint.unit.last_ball_unit,
					messages: messages,
					transfersInfo: transfersInfo,
					outputsUnit: unitOutputs,
					timestamp: objJoint.unit.timestamp,
					assocCommissions: assocCommissions,
					arrAaResponses: arrAaResponses,
					trigger_unit: trigger_unit,
					isAsset,
					objJoint,
				};

				if (unitProps.is_stable) {
					const {
						full_node_confirmation_delay,
						light_node_confirmation_delay
					} = await getConfirmationDelays(objJoint);
					objInfo.light_node_confirmation_delay = light_node_confirmation_delay;
					objInfo.full_node_confirmation_delay = full_node_confirmation_delay;
				}
				
				if (parseInt(objJoint.unit.version) >= 4) {
					return resolve(objInfo);
				}

				if (objJoint.unit.witnesses) {
					objInfo.witnesses = objJoint.unit.witnesses;

					resolve(objInfo);
				} else {
					objInfo.witnesses = await storage.readWitnesses(db, unit);

					resolve(objInfo);
				}
			},
			ifNotFound: function () {
				resolve(null);
			}
		});
	})
}


async function getUnitsThatBecameStable(arrUnits) {
	if (!arrUnits.length) {
		return [];
	}

	return db.query("SELECT unit, is_on_main_chain, is_stable FROM units WHERE unit IN("+arrUnits.map(db.escape).join(', ')+") AND is_stable=1");
}

async function getRowIdByUnit(unit) {
	return db.query("SELECT ROWID FROM units WHERE unit = ? LIMIT 0,1", [unit]);
}

exports.getLastUnits = getLastUnits;
exports.getUnitsBeforeRowId = getUnitsBeforeRowId;
exports.getUnitsAfterRowId = getUnitsAfterRowId;
exports.getInfoOnUnit = getInfoOnUnit;
exports.getUnitsThatBecameStable = getUnitsThatBecameStable;
exports.getRowIdByUnit = getRowIdByUnit;
exports.getTriggerUnit = getTriggerUnit;
