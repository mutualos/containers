//globals 
var G_product_count = <?= json_encode($loan_counts) ?>;
var G_portfolio_table = [];
var G_product_table = <?= json_encode($product_table) ?>;

let USDollar = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

function encrypt_text(text_obj) {
    const encrypted = CryptoJS.AES.encrypt(text_obj, '<?= $client_phrase ?>');
    return encrypted;
}

function validate_header(header) {
    var header_errors = '';
    var columns = header.split(',');
    config_headers = <?= json_encode(array_keys($container_config['fields'])) ?>;
    for (i=0; i < config_headers.length; i++) {  
        if (!columns.includes(config_headers[i])) {
            header_errors += 'missing header column: ' + config_headers[i] + '\n';
        }
    }
    return header_errors;
}

function encrypt_id(id_column, file_content) {
    let rows = file_content.split(/\r?\n|\r|\n/g);
    for (i=1; i < rows.length; i++) {    
        let columns = rows[i].split(',');
        columns[id_column] = encrypt_text(columns[id_column]);
        //trim spaces
        for (j=0; j < columns.length; j++) {
            if ( j != id_column) {
                columns[j] = columns[j].trim();
            }
        }
        rows[i] = columns.join(',');
    }
    return rows.join('\n');
}

function _1remaining_life_in_months(columns, header_) {
    let $maturity_date = new Date(columns[header_.indexOf('maturity_date')]); 
    let today = new Date();
    let time_difference = $maturity_date.getTime() - today.getTime();
    return parseInt(time_difference / (1000 * 60 * 60 * 24 * 30));  
}

function _1remaining_life_in_years(columns, header_) {
    let $maturity_date = new Date(columns[header_.indexOf('maturity_date')]); 
    let today = new Date();
    let time_difference = $maturity_date.getTime() - today.getTime();
    return parseFloat(time_difference / (1000 * 60 * 60 * 24 * 365));  
}

function _1current_life_in_years(columns, header_) {
    let $origination_date = new Date(columns[header_.indexOf('origination_date')]);  
    let today = new Date();
    let time_difference = today.getTime() - $origination_date.getTime();
    return parseFloat(time_difference / (1000 * 60 * 60 * 24 * 365));  
}

function _1average_outstanding(columns, header_) {
    let $payment = parseFloat(columns[header_.indexOf('payment')]);
    let $principal_temp = parseFloat(columns[header_.indexOf('principal')]);
    let $monthly_rate = parseFloat(columns[header_.indexOf('rate')]) / 12;
    let $months = Math.max(Math.min(_1remaining_life_in_months(columns, header_), 360), 1);
    let principal_sum = 0;
    let month = 0;
    while (month < $months && $principal_temp > 0) {
        principal_sum += $principal_temp;
        $principal_temp -= $payment - $principal_temp * $monthly_rate;
        month++;
    }
    average_outstanding = parseFloat(principal_sum / $months);
    if (average_outstanding < 0) {
        console.log('warning: average outstanding below zero', header_, columns);
    }
    return average_outstanding;
}

function _1cost_of_funds(columns, header_) {
    let $payment = parseFloat(columns[header_.indexOf('payment')]);
    let $principal_temp = parseFloat(columns[header_.indexOf('principal')]);
    let $monthly_rate = parseFloat(columns[header_.indexOf('rate')]) / 12;
    let $months = Math.max(Math.min(_1remaining_life_in_months(columns, header_), 360), 1);
    let COFR_map_ = <?= json_encode($curve_array) ?>;
    let principal_sum = 0;
    let paydown = 0;
    let month = 1;
    let COF_sum = 0;
    while (month <= $months && $principal_temp > 0) {
        paydown = $payment - $principal_temp * $monthly_rate;
        COF_sum += paydown * COFR_map_[month] / 100 * month;
        $principal_temp -= paydown
        month++;
    }
    return COF_sum / $months;
}

function _1interest_income(columns, header_) {
    let risk_rating_map_ = <?= json_encode($container_config['risk_rating_map']) ?>;
    let $risk_rating = columns[header_.indexOf('risk_rating')].trim();
    if (risk_rating_map_[$risk_rating] == 'non-accrual') {
        return 0;
    } else {
        let $rate = columns[header_.indexOf('rate')];
        if ($rate > 1 && $rate <= 100) {
            $rate = $rate / 100;
        } else if ($rate < .001 || $rate > 100)  {
            return "rate out of range";
        }
        return _1average_outstanding(columns, header_) * $rate;
    }
}

function _1fees(columns, header_) {
    $fees = columns[header_.indexOf('fees')] / _1current_life_in_years(columns, header_);
    return $fees;
}

function _1reserve_expense(columns, header_) {
    let $type = columns[header_.indexOf('type')].trim();
    let $risk_rating = columns[header_.indexOf('risk_rating')].trim();
    let type_map_ = <?= json_encode($container_config['type_map']) ?>;
    let default_map_ = <?= json_encode($container_config['default_map']) ?>;
    let risk_rating_map_ = <?= json_encode($container_config['risk_rating_map']) ?>;
    if (typeof type_map_[$type] === 'undefined') {
        return 'type ' + $type + ' missing from config map';
    } else {
        if (risk_rating_map_[$risk_rating] == 'non-accrual') {
            default_probability_ = 0;
        } else if (typeof risk_rating_map_[$risk_rating] === 'undefined') { 
            default_probability_ = default_map_[type_map_[$type][1]]; //no adjustment    
        } else {
            let risk_adjustment = parseInt(risk_rating_map_[$risk_rating]);
            default_probability_ = default_map_[type_map_[$type][1]] * risk_adjustment;
        }
        let default_LTV_ = 0.80;
        let default_collateral_recovery_ = 0.50;
        let exposure_at_default_ = 1 / default_LTV_ * default_collateral_recovery_;
        let average_outstanding = _1average_outstanding(columns, header_);
        let operating_risk_minimum_ = <?= $container_config['operating_risk_minimum'] ?>;
        let reserve_expense = average_outstanding * operating_risk_minimum_  >  average_outstanding * exposure_at_default_ * default_probability_ ? average_outstanding * operating_risk_minimum_ : average_outstanding * exposure_at_default_ * default_probability_;
        let id_filter = document.getElementById('id-filter').value.trim();
        if (id_filter != null && id_filter != "") {
            document.getElementById('screen-console').textContent += "reserve expense : " + USDollar.format(reserve_expense) + '\n';   
        }
        return reserve_expense;
    }
}

function _1operating_expense(columns, header_) {
    //version 1 -- origination principal factor adjusted by institution's efficiency
    //y-intercept
    $principal = columns[header_.indexOf('principal')];
    $type = columns[header_.indexOf('type')].trim();
    G_product_count[$type] += 1;
    let type_map_ = <?= json_encode($container_config['type_map']) ?>;
    if (typeof type_map_[$type] === 'undefined') {
        return 'type ' + $type + ' missing from config map';
    } else {
        let product_map_ = <?= json_encode($container_config['product_map']) ?>;
        let cost_factor = product_map_[type_map_[$type][1]][1];
        let m = (cost_factor - cost_factor * 2) / (cost_factor * 1000000);
        let origination = $principal * m + cost_factor * $principal / 100;
        let servicing = $principal * <?= $container_config['servicing_factor'] ?>;
        let operating_expense = parseFloat((origination + servicing) / Math.max(_1current_life_in_years(columns, header_), 5));
        let id_filter = document.getElementById('id-filter').value.trim();
        if (id_filter != null && id_filter != "") {
            document.getElementById('screen-console').textContent += "operating expense : " + USDollar.format(operating_expense) + '\n';   
        }
        return operating_expense;
    }
}

function _1loan_profit(columns, header_)  {  //version 1 denoted by _1
    let interest_income = _1interest_income(columns, header_);
    if (typeof interest_income === 'string') return 'error 1: ' + interest_income; 
    let fees = _1fees(columns, header_);
    if (typeof fees === 'string') return 'error 2: ' + fees;
    let cost_of_funds = _1cost_of_funds(columns, header_);
    let operating_expense = _1operating_expense(columns, header_);
    if (typeof operating_expense === 'string') return 'error 3: ' + operating_expense;
    let net_income = interest_income + fees - operating_expense - cost_of_funds;
    let tax_rate_ = <?= $container_config['tax_rate'] ?>;
    let tax_expense = tax_rate_ * net_income;
    net_income -= tax_expense;
    //let reserve_expense = _1reserve_expense(row);
    //let net_income = (interest_income + fees - operating_expense - funding_expense) * (1 + tax_rate) - reserve_expense;
    //net_income = operating_expense;
    let reserve_expense = _1reserve_expense(columns, header_);
    if (typeof reserve_expense === 'string') return 'error 3: ' + reserve_expense;
    net_income -= reserve_expense;
    if (isNaN(net_income)) console.log(header_, columns, _1interest_income(columns, header_), _1fees(columns, header_), _1cost_of_funds(columns, header_), _1operating_expense(columns, header_), _1reserve_expense(columns, header_), _1average_outstanding(columns, header_), $type = columns[header_.indexOf('type')].trim() );
    return net_income;
}

function _1build_report_table(name, header_array, table_array, counter=false) {
    let sum = [];
    table = document.createElement('table'); 
    table.classList.add('table');
    table.setAttribute("id", name.replace(/ /g,"_"));
    heading = document.createElement('thead'); 
    tr = document.createElement('tr'); 
    if (counter) {
        th = document.createElement('th'); 
        th.innerHTML = '#';
        tr.appendChild(th);
    }
    header_array.forEach(function(head, h_index) {
        th = document.createElement('th'); 
        th.innerHTML = head;
        tr.appendChild(th);
    });
    heading.appendChild(tr);
    table.appendChild(heading);  
    let count = 1;
    table_array.forEach(function(row, r_index) {
        if (row[row.length-1] != 0) { //hack
            tr = document.createElement('tr');
            if (counter) {
                td = document.createElement('td'); 
                td.innerHTML = count;
                tr.appendChild(td);
                count++;
            }
            for (column = 0; column < row.length; column++) {
                td = document.createElement('td');
                if ( row[column] !== "" && !isNaN(row[column]) ) {
                    if (Math.round(row[column]) != row[column]) {
                        td.innerHTML = USDollar.format(row[column]);
                    } else {
                        td.innerHTML = row[column];
                    }
                    if (typeof sum[column] === 'undefined') {
                        sum[column] = row[column];
                    } else {
                        sum[column] += row[column];
                    }   
                } else {
                    td.innerHTML = row[column];
                }
                tr.appendChild(td);
            }
            table.appendChild(tr);
        }
    });
    tr = document.createElement('tr');
    if (counter) {
        th = document.createElement('th');
        th.innerHTML = '';
        tr.appendChild(th);
    }
    th = document.createElement('th');
    th.innerHTML = '';
    tr.appendChild(th);
    for (column = 1; column < header_array.length; column++) {
        th = document.createElement('th');
        if (typeof sum[column] === 'undefined') {
            th.innerHTML = '';
        } else if ( Math.round(sum[column]) != sum[column] ) {
            th.innerHTML = USDollar.format(sum[column]);
        } else {
            th.innerHTML = sum[column];
        }
        tr.appendChild(th);
    }
    table.appendChild(tr);
    document.getElementById('report_div').appendChild(table);
}

function _1catalog_data(columns, header_) {
    header_.forEach(function(column, c_index) {
        document.getElementById('screen-console').innerHTML += column + " : " + columns[header_.indexOf(column)] + '\n';
    });
}

function start_upload(e) {
    e.preventDefault();
    var file = e.target.files[0];
    if (!file) {
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        let file_content = e.target.result;
        let id_filter = document.getElementById('id-filter').value.trim();
        let CR = file_content.indexOf('\r');
        let LF = file_content.indexOf('\n');
        let header_end = LF > CR ? LF : CR;
        let $file_header = file_content.substring(0, header_end);
        let errors = validate_header($file_header);
        if (errors) {
            document.getElementById('file-errors').textContent = errors; 
        } else {
            header_ = <?= json_encode(array_values($container_config['fields'])) ?>;
            //encrypt ID fields, if necessary
            //let column_index = header_.indexOf('ID');
            //document.getElementById('screen-console').textContent = encrypt_id(column_index, file_content);
            let rows = file_content.split(/\r?\n|\r|\n/g);
            for (i=1; i < rows.length; i++) {  
                let columns = rows[i].split(',');
                let $principal = parseFloat(columns[header_.indexOf('principal')]);
                if ($principal != 0) {
                    let $id = String(columns[header_.indexOf('ID')]).trim();
                    if ($id == id_filter || id_filter == null || id_filter == "") {
                        if (id_filter != null && id_filter != "") {
                            _1catalog_data(columns, header_);    
                        }
                        //log warning
                        if( _1current_life_in_years(columns, header_) > 20 ) console.log(columns[header_.indexOf('principal')]);
                        let $type = parseInt(columns[header_.indexOf('type')]);
                        let loan_profit = parseFloat(_1loan_profit(columns, header_));
                        temp_index = G_portfolio_table.findIndex(function(v,i) {
                            return v[0] == $id});
                        if (temp_index === -1)  {
                            G_portfolio_table.push([$id, loan_profit, 1]); 
                        } else {
                            G_portfolio_table[temp_index][1] += loan_profit;  
                            G_portfolio_table[temp_index][2] += 1; 
                        }
                        temp_index = G_product_table.findIndex(function(v,i) {
                            return v[0] === $type});
                        G_product_table[temp_index][2] += loan_profit;
                        G_product_table[temp_index][3] += $principal;
                        G_product_table[temp_index][4] += 1;
                    }
                }
            }
            //sort product report by profit 
            G_product_table.sort((a, b) => parseFloat(b[2]) - parseFloat(a[2]));
            _1build_report_table('product report', ['Type code', 'Product', 'Profit', 'Principal', 'Q'], G_product_table);
            
            //sort ranking report by profit
            G_portfolio_table.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
            _1build_report_table('ranking report', ['ID', 'Profit', 'Q'], G_portfolio_table, true);
            Modal_.hide();
        }
    };
    reader.readAsText(file);
}
document.getElementById('file-input').addEventListener('change', start_upload, false);
