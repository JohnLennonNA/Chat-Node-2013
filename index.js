var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var url = require('url') ;
var nodemailer = require('nodemailer'),
  transport = nodemailer.createTransport('direct', {
    debug: true, 
  });

var mysql      = require('mysql');
var connection = mysql.createConnection({
    host     : 'YOURHOST',
    user     : 'YOURUSER',
    password : 'YOURPASSWORD',
    database : 'YOURDATABASE'
});

connection.connect();

var fila = [];
var imobiliarias = [];
var configuracoes = [];
var atendimento = [];
var refDebug = "";

app.get('/', function(req, res){
    var path = require('path');
    res.sendFile('fila.html', { root: path.join(__dirname, '/') } );
});

app.get('/atendimento/', function(req, res ){
    var path = require('path');
    res.sendFile('atendimento.html', { root: path.join(__dirname, '/') } ); 
});

app.get('/chat/', function(req, res ){
    var path = require('path');
    res.sendFile('chat.html', { root: path.join(__dirname, '/') } );
});

app.get('/debug/', function(req, res ){
    var path = require('path');
    res.sendFile('debug.html', { root: path.join(__dirname, '/') } );
});

io.on('connection', function(socket){
   
    socket.on('enviaConf', function( status, tipoConfig, chatNumber){
        
            for(i in configuracoes){
                if( configuracoes[i].idChatNumber == chatNumber){
                    configuracoes[i].minimiza = status;
                }
            }
    });

    socket.on('entraFila', function(idCliente, nome, email, telefone, atend, urlInteresse, titleImovel, chatNumberUser ){
        
        if(idCliente > 0){
            envialEmail(nome, email, telefone, urlInteresse, idCliente);
        }

        var queryObject = {
            id:     socket.id,
            imob:   idCliente,
            n:      nome,
            t:      telefone,
            e:      email,
            fila:   0,
            url:    urlInteresse,
            atend:  atend,
            titleImovel: titleImovel,
            chatNumberUser: chatNumberUser
        };

        var filaInt = parseInt(queryObject.imob);
        var qtdFila = addUserToFila( queryObject );

        if(testeEmit(queryObject.id)){
            if( queryObject.imob != 0 ){
                connection.query('SELECT * from client where id = '+queryObject.imob, function(err, rows, fields) {    
                    io.sockets.connected[queryObject.id].emit('informativoFila', qtdFila, rows);
                });
            }else{
                io.sockets.connected[queryObject.id].emit('informativoFila', qtdFila, '');
            }
            
            monitoraFila(queryObject.fila);
            io.sockets.connected[queryObject.id].emit('definiAtendimento', queryObject );
        }
    });

    socket.on('IniciaFilaAtend', function(){
        var dados = url.parse(socket.handshake.headers.referer,true).query;

        dados.id = socket.id;
        dados.idImob = 0;

        iniciaFilaImobiliaria( dados, 0 );
    });

    socket.on('IniciaFilaImob', function( idImob, nmImobi, chatNumber){
        var config = 1;
        var flag = 0;

        for(i in configuracoes){
            if( configuracoes[i].idChatNumber == chatNumber){
                config = configuracoes[i].minimiza;
                flag = 1;
            }
        }

        if(flag == 0){
            var dados = {
                idChatNumber: chatNumber.toString(),
                minimiza: config
            }

            configuracoes.push(dados);
        }

        chatNumber = chatNumber.toString();

        var dados = {
            idImob : idImob,
            nmImobi: nmImobi,
            chatNumber: chatNumber,
            id: socket.id,
            configMin: config
        }

        iniciaFilaImobiliaria( dados, 2 );
    });

    socket.on('IniciaAtend', function(dados, nmAtendente, chatNumber){

        var defineFila = parseInt(dados.fila);

        atendimento[dados.atend] = [];

        for( i in imobiliarias[defineFila] ){
            if( imobiliarias[defineFila][i].chatNumber == chatNumber ){
                atendimento[dados.atend].push(imobiliarias[defineFila][i]);
            }
        }

        atendimento[dados.atend].push(dados);

        for (var i in atendimento[dados.atend]){
            var referencia = atendimento[dados.atend][i].id;

            if(testeEmit(referencia)){
                io.sockets.connected[referencia].emit('entraAtend', dados.atend);
            }
        }

        fila[defineFila].shift();



        var date = new Date();
        var hora = date.getHours();

        var welcomeMesage = '';

        if(hora < 12){
            welcomeMesage = welcomeMesage+'Bom dia';
        }else if(hora < 18){
            welcomeMesage = welcomeMesage+'Boa Tarde';
        }else{
            welcomeMesage = welcomeMesage+'Boa Noite';
        }

        welcomeMesage = welcomeMesage+' <b>'+dados.n+'</b><br>';

        if(dados.url != ''){
            welcomeMesage = welcomeMesage+'Vejo que você está pesquisando o imóvel... <b>'+dados.titleImovel+'</b><br>';
        }

        if(nmAtendente != ''){
            welcomeMesage = welcomeMesage+'Meu nome é <b>'+nmAtendente+'</b> estou aqui para atende-lo.';
        }

        propagacao( dados.atend, 'Atendente : '+welcomeMesage);

        atualizaInfoLead(dados.atend, '');
        monitoraFila(defineFila);
        informaStatusImob(dados.imob);
        updateStatusLead(dados.atend, 2);
    });

    socket.on('mensagem', function(msg, filaRef, atendimentoRef){

        var date        = new Date();
        var mes         = date.getMonth() + 1;
        var remetente   = msg.split(':');
        var dataMsg     = date.getFullYear()+'-'+mes+'-'+date.getDate()+' '+date.getHours()+':'+date.getMinutes()+':'+date.getSeconds();

        connection.query('INSERT INTO conversasAtendimento ( interesse_id, mensagem, remetente, sendDate ) VALUES("'+atendimentoRef+'", "'+msg+'", "'+remetente[0]+'", "'+dataMsg+'") ' , function(err, rows, fields) {});

        propagacao( atendimentoRef, msg);
    });

    socket.on('conviteImobiliaria', function( dados ){
        if(atendimento[dados.atend].length < 3){

            connection.query('UPDATE interesse SET send_invitation = 1 WHERE id = '+dados.atend, function(err, rows, fields) {
                if(err){
                    console.log(err);
                }
            });
        
            for(i in imobiliarias[dados.idImob]){
                if(testeEmit(imobiliarias[dados.idImob][i].id)){
                    io.sockets.connected[ imobiliarias[dados.idImob][i].id ].emit('enviaConvite',  atendimento[dados.atend][1] );
                }else{
                    console.log('o id da imobiliaria nao foi encontrado');
                }
            }
        }
        // console.log('convite ||||||||||||||||||||||||||||||');
    });

    socket.on('entraAtendConvidado', function( dados ){
        dados.id = socket.id;

        if( atendimento[dados.atend] ){
            atendimento[dados.atend].push(dados);
            for( i in imobiliarias[dados.idImob] ){
                var referencia = imobiliarias[dados.idImob][i].id;

                if(testeEmit(referencia)){
                    io.sockets.connected[referencia].emit('removeConviteAtendido', dados.atend );
                }
            }
        }

        updateStatusLead(dados.atend, 3);

        connection.query('UPDATE interesse SET status_convite = 1 WHERE id = '+dados.atend, function(err, rows, fields) {
            if(err){
                console.log(err);
            }
        });

        // console.log('|||||||||||||||||||||||||||||||||||||||||||');
        // console.log('dados da imob q foi add');
        // console.log(dados);

        var welcomeMesage = 'Ola colega da '+dados.nmImob+'.<br> Sou o '+atendimento[dados.atend][0].nomeUser+', estou atendendo o cliente '+atendimento[dados.atend][1].n+' e surgiu uma duvida:';
        propagacao( dados.atend, 'Atendente: '+welcomeMesage);
    });

    socket.on('rejectCall', function( atendimentoRef ){
        connection.query('UPDATE interesse SET status_convite = 2 WHERE id = '+atendimentoRef, function(err, rows, fields) {
            if(err){
                console.log(err);
            }
        });
    });

    socket.on('updateLeadAtend', function( idAtend, msg ){
        atualizaInfoLead(idAtend, msg);
    });

    socket.on('verifActiveChatUser', function( chatNumberUser ){       
        
        var flag = 0;
        var answer = 0;
        var dados = '';
        
        for( atend in atendimento){

            for( entraatend in atendimento[atend]){

                if( typeof atendimento[atend][entraatend].chatNumberUser != 'undefined' ){

                    if( atendimento[atend][entraatend].chatNumberUser == chatNumberUser  ){
                        
                        atendimento[atend][entraatend].id = socket.id;
                        dados = atendimento[atend][entraatend];
                        answer = 1;

                        connection.query('SELECT * from conversasAtendimento where interesse_id = '+atend+' order by id asc', function(err, rows, fields) {
                            if(err){
                                console.log(err);
                            }

                            io.sockets.connected[socket.id].emit('answerVerifActiveChatUser', answer, dados, rows );
                        });
                    }
                }               
            }
        }
    });

    socket.on('removeConvidado', function( atendimentoRef ){
        atendimento[atendimentoRef].pop();

        var msg = "aviso: A imobiliária deixou o atendimento";

        for( i in atendimento[atendimentoRef] ){
            var referencia = atendimento[atendimentoRef][i].id;

            if(testeEmit(referencia)){
                io.sockets.connected[referencia].emit('propagaMsg', msg, atendimentoRef);
            }
        }
    });

    socket.on('finalizaAtend', function( atendimentoRef, filaRef ){
        var msg = 'O atendimento foi finalizado, obrigado pelo contato';

        // propagacao(atendimentoRef, msg);
        for( i in atendimento[atendimentoRef] ){
            var referencia = atendimento[atendimentoRef][i].id;

            if(testeEmit(referencia)){
                io.sockets.connected[referencia].emit('fechaJanelasAtend', msg, atendimentoRef);
            }
        }
        atendimento[atendimentoRef] = {};
    });

    socket.on('exitAttendance', function(atendimentoRef, nomeUser){
        if(atendimentoRef != ""){
            console.log('fecha atend:'+atendimentoRef);
            var msg = "aviso: O usuário "+nomeUser+" desconectou do atendimento.<br> Lembramos que este usuario ja aparece em sua lista de interessados (Dashboard > Interessados ), para que você possa dar continuidade ao atendimento.";
            for( var i in atendimento[atendimentoRef]){
                var referencia = atendimento[atendimentoRef][i].id;
                if( referencia != socket.id ){

                    if(testeEmit(referencia)){
                        io.sockets.connected[referencia].emit('fechaJanelasAtend', msg, atendimentoRef);
                    }
                }
            }

            atendimento[atendimentoRef] = {};
        }
    });

    socket.on('monitoraPaginas', function( chatNumberUser, urlImovel, idImovel, atendimentoRef, codImovel ){       
        // console.log(atendimento[atendimentoRef][1]);
        if( atendimento[atendimentoRef][1].imob == 0 ){
            // console.log('envio pro cliente');

        // FINALIZAR O SELECT PARA TRAZER AS INFO DA IMOBILIARIA TB
            // connection.query('SELECT client_id from imovel where id = '+idImovel, function(err, rows, fields){
                    // io.sockets.emit('propagaStatusImob', idImob, rows, status);
                var referencia = atendimento[atendimentoRef][0].id;
                io.sockets.connected[referencia].emit('updatePageCliente', urlImovel,idImovel, atendimentoRef, codImovel);
            // });

        }
        // console.log('O cliente '+chatNumberUser+' esta vendo o imóvel'+idImovel);
    });

    socket.on('addImovelToUpdate', function( atendimentoRef, idImovel ){       
        connection.query('UPDATE interesse SET imovel_id = '+idImovel+' WHERE id = '+atendimentoRef, function(err, rows, fields) {
        if(err){
            console.log(err);
        }else{
                connection.query('SELECT im.client_id, im.title, concat("/imovel/",lower(tpi.title), "/", im.slug ) as url, im.slug from imovel as im INNER JOIN tipo_imovel as tpi on (im.tipo_id = tpi.id ) where im.id = '+idImovel, function(err, rows, fields){
                
                envialEmail(atendimento[atendimentoRef][1].n, atendimento[atendimentoRef][1].e, atendimento[atendimentoRef][1].t, rows[0].url, rows[0].client_id);

                atendimento[atendimentoRef][1].imob = rows[0].client_id;
                atendimento[atendimentoRef][1].titleImovel = rows[0].title;
                atendimento[atendimentoRef][1].url = rows[0].url;
                // console.log('===============================')
                var referencia = atendimento[atendimentoRef][0].id;
                if(testeEmit(referencia)){
                    io.sockets.connected[referencia].emit('updateDataInterest', atendimento[atendimentoRef][1] );
                }

                informaStatusImob(rows[0].client_id);
            });
        }
    });

    });

    // EMITS DE DEBUG ====
    socket.on('habilitaDebug', function(){
        refDebug = socket.id;
        // console.log(">>>>> definiu o refDebug:"+refDebug);
    });

    socket.on('imobOn', function(){
        var imobTestadas = [];
        for(im in imobiliarias){
            for(imt in imobiliarias[im]){
                if(imobiliarias[im]){
                    if(testeEmit(imobiliarias[im][imt].id)){
                        // console.log(imobiliarias[im]);
                        imobTestadas[im] = imobiliarias[im];
                    }else{
                        console.log("nao conseguil acessar não");
                    }
                }
            }
        }

        if(testeEmit(refDebug)){
            // connection.query('SELECT c.nome_fantasia, c.id FROM client ', function(err, rows, fields){
            connection.query('SELECT name as nome_fantasia, id FROM client', function(err, rows, fields){
                
                if (!err){
                    io.sockets.connected[refDebug].emit('imobOnResponse', imobTestadas, rows);
                }else{
                    console.log('Error while performing Query.');
                }
            });
        }
    });

    socket.on('reconnectImob', function( idImob ){

        console.log(idImob);
        // console.log(imobiliarias[idImob]);

        if( idImob != ""){
            for(im in imobiliarias[idImob]){
                console.log("Emitiu p/ "+imobiliarias[idImob][im].id);
                if(testeEmit(imobiliarias[idImob][im].id)){
                    io.sockets.connected[imobiliarias[idImob][im].id].emit('iniciaChat');
                }else{
                    console.log("Não conseguil emitir sa porra");
                }
            }
        }
    });

    socket.on('autentica', function( idImob, chartNumber, socketID ){       
        for( imob in imobiliarias[idImob]){
            if( imobiliarias[idImob][imob].chatNumber == chartNumber){               
                if(imobiliarias[idImob][imob].id != socketID){
                    imobiliarias[idImob][imob].id = socketID;
                    console.log("============ ID Redefinido Atendente Imob :"+idImob);
                }
            }
        }
    });

    socket.on('disconnect', function(){

        var perfil = 0;
        var atendeRef = 0;
        var filaRef = 0;

        // DEFINE O PERFIL DO USUÀRIO QUE SAIU
        for( im in imobiliarias){
            for(at in imobiliarias[im]){
                if( imobiliarias[im][at].id == socket.id ){
                    perfil = 1;
                    atendeRef = at;
                    filaRef = im;

                    // console.log("Chave a ser destruida: "+im);
                }
            }
        }

        // PERFIL : 0 = Imobiliaria | 1 = Atendente
        // VERIFICA SE O ID DO SOCKET ESTA EM ALGUM ATENDIMENTO
        if(perfil == 0){
            for( i in atendimento){
                for( x in atendimento[i]){
                    if( atendimento[i].length > 2 ){  
                        if( atendimento[i][2].id == socket.id ){
                            if(atendimento[i][2].chatNumber){
                                perfil = 1;
                                filaRef = atendimento[i][2].idImob;
                                atendeRef = 2;
                                // console.log("A imobiliaria esta em atendimento");
                            }
                        }
                    }
                }
            }
        }

        // REMOVE O USUARIO SE ESTIVER NA FILA AINDA
        if(perfil == 0){
            var remove = null;
            
            for (var i in fila){
                for (var x = 0; x < fila[i].length; x++){          
                    if(fila[i][x].id == socket.id){           
                        remove = x;
                    }
                };
                if(remove != null){
                    for (var y = remove; y < fila[i].length; y++){
                        var z = y + 1;
                        fila[i][y] = fila[i][z];
                    }
                    fila[i].pop();
                    monitoraFila(i);
                }
            }
        }
        else
        {
            var fechaFila = verifExistenciAtend(socket.id);
            // console.log("Verifica existencia de atend : ");
            // console.log(fechaFila);
            // console.log("===============================");

            if(fechaFila.flag == 0 ){
                var qtdAtend = imobiliarias[filaRef].length;
                console.log("qtd atendentes = "+qtdAtend);
                if(qtdAtend <= 1){
                    // imobiliarias.splice(filaRef, 1);
                    imobiliarias[filaRef] = [];
                    console.log(">>elimino todos os atendentes se tinha algum");

                    fila[filaRef] = [];
                    if(filaRef > 0){
                        informaStatusImob(filaRef);
                    }
                }else{
                    imobiliarias[filaRef].splice(atendeRef, 1);
                }
                // console.log("aplicado na chave"+filaRef);
            }
        }

        // console.log('Saiu =========>'+socket.id);
    });
});

http.listen(3000, function(){
    console.log('');
    console.log('');
    console.log('||====================================||');
    console.log('||                                    ||');
    console.log('|| Aplicação rodando na porta 3000    ||');
    console.log('||                                    ||');
    console.log('||====================================||');

    setTimeout(function(){ 
        io.sockets.emit('iniciaDebug');
        io.sockets.emit('iniciaChat');
        io.sockets.emit('fechaJanelasAtend', 'Houve algum problema com a conexão tente novamente em instantes', 0);
     }, 3000);
});

function addUserToFila( dados ){
    // console.log("dados do usuário que entro na fila");
    // console.log(dados);

    if( fila[dados.fila] ){
        fila[dados.fila].push( dados );
        return fila[dados.fila].length; 
    }else{
        return 0;
    }
}

function iniciaFilaImobiliaria( dadosAtendente, posiId ){   
  
    var flag = 0;

    // VERIFICA SE JA TEM ALGUM ATENDENTE COM O CHATNUMBER
    for(im in imobiliarias[dadosAtendente.idImob]){
        if(imobiliarias[dadosAtendente.idImob][im].chatNumber == dadosAtendente.chatNumber){
            imobiliarias[dadosAtendente.idImob][im].id = dadosAtendente.id;
            flag = 1;
        }
    }
    
    // CASO NAO TENHA
    if(flag == 0)
    {
        if(!fila[dadosAtendente.idImob]){
            fila[dadosAtendente.idImob] = [];
            imobiliarias[dadosAtendente.idImob] = [];
        }      

        imobiliarias[dadosAtendente.idImob].push(dadosAtendente);
        imobiliarias[dadosAtendente.idImob];

        // console.log("Qtd Atendentes: "+imobiliariasObj[dadosAtendente.idImob].keys(a).length);
        // EQUIVALENTE
        // imobiliariasObj.idImob = dadosAtendente.idImob;
        // imobiliariasObj[dadosAtendente.idImob] = dadosAtendente;
        // EQUIVALENTE
        // console.log("Qtd Atendentes: "+Object.keys(imobiliariasObj[dadosAtendente.idImob]).length);

        if(testeEmit(dadosAtendente.id)){
            io.sockets.connected[dadosAtendente.id].emit('definiFilaAtendente', dadosAtendente);
        }

        if(dadosAtendente.idImob > 0 ){
            informaStatusImob(dadosAtendente.idImob);
        }
    }
    else
    {
        for( i in atendimento){
            for( x in atendimento[i]){

                if( typeof atendimento[i][x].chatNumber != 'undefined' ){

                    if( atendimento[i][x].chatNumber == dadosAtendente.chatNumber ){
                        atendimento[i][x].id = dadosAtendente.id;

                        // console.log('acho o atendente em um atendimento');

                        if(testeEmit(dadosAtendente.id)){
                            io.sockets.connected[dadosAtendente.id].emit('definiFilaAtendente', dadosAtendente);
                        }else{
                            // console.log('nao conseguiu enviar o emit para o atendente achado');
                        }
                        
                        remontaAtend(i, dadosAtendente.id, atendimento[i][1].imob );
                    }
                }
            }
        }
    }

    InformaImobEntrou(dadosAtendente, imobiliarias[dadosAtendente.idImob]);

    monitoraFila(dadosAtendente.idImob);
}

function informaStatusImob(idImob){
    if(idImob == 0){
        io.sockets.emit('propagaStatusImob', idImob, '', 1);
    }
    else
    {
        var status = 0;

        if(fila[idImob]){
            status = 1;

            registraEntradaImob(idImob);
        }

        connection.query('SELECT nome_fantasia, phone, email, logo from client where id = '+idImob, function(err, rows, fields){
            if (!err){
                io.sockets.emit('propagaStatusImob', idImob, rows, status);
            }else{
                console.log('Error while performing Query.');
            }
        });
    }
}

function atualizaPosicaoUsuario(idImobiliaria){
    for (var i in fila[idImobiliaria]){   
        var qtdFila = parseInt(i) + 1;
        var idClienteConectado = fila[idImobiliaria][i].id;

        if(testeEmit(idClienteConectado)){
            io.sockets.connected[idClienteConectado].emit('informativoFila', qtdFila );
        }
    }
}

function monitoraFila(imob){
    var nimob = parseInt(imob);
    // console.log("idImob Recebido:"+imob);
    // console.log("Quantidade de Atendentes: "+imobiliarias[nimob].length);
    if(fila[nimob] && nimob == 0){
        for( i in imobiliarias[nimob]){
            // console.log("teste p/ "+imobiliarias[nimob][i].nomeUser);
            if(testeEmit(imobiliarias[nimob][i].id)){
                // console.log("Envio para:"+imobiliarias[nimob][i].nomeUser+" | id:"+imobiliarias[nimob][i].id+"| ChatNumber"+imobiliarias[nimob][i].chatNumber);
                io.sockets.connected[ imobiliarias[nimob][i].id ].emit('enviaFilaFull', fila[nimob] );
            }
        }
    }
}

function propagacao(atendimentoRef, msg){
    for( i in atendimento[atendimentoRef] ){
        var referencia = atendimento[atendimentoRef][i].id;

        if(testeEmit(referencia)){
            io.sockets.connected[referencia].emit('propagaMsg', msg, atendimentoRef);
        }
    }

    // console.log("|||||||||||||||||||||||||||||||||");
}

function remontaAtend(atend, socketId, idImob){

    // console.log('===============');
    // console.log('Select de msg realizado em cima do atendimento: '+atend);

    connection.query('SELECT * from conversasAtendimento where interesse_id = '+atend+' order by id asc', function(err, rows, fields) {
        if(err){
            console.log(err);
        }
       
        if(testeEmit(socketId)){     
            io.sockets.connected[socketId].emit('remontagem', atendimento[atend][1], rows);
        }
    });
    
    informaStatusImob(idImob);
    

    // console.log(idImob);
    // console.log('monitora fila ===============');
}

function verifExistenciAtend(socketId){

    var dados = {
        flag: 0,
        atend: 0,
        posi: '',
        infoUser: {}
    }

    for(at in atendimento){
        for(us in atendimento[at] ){
            if( atendimento[at][us].id == socketId ){
                dados.flag  = 1;
                dados.atend = at;
                dados.posi  = us;
                dados.infoUser = atendimento[at][us];
            }
        }
    }

    return dados;
}

function atualizaInfoLead(idAtend, msg){

    if(msg == ''){
        msg = "Cliente atendido no atendimento online";
    }

    connection.query('UPDATE interesse SET message = "'+msg+'" WHERE id = '+idAtend, function(err, rows, fields) {
        if(err){
            console.log(err);
        }
    });
}

function updateStatusLead(idLead, status){
    connection.query('UPDATE interesse SET status_interesse = '+status+' WHERE id = '+idLead, function(err, rows, fields) {
        if(err){
            console.log(err);
        }
    });
}

function testeEmit(referencia){
    try {
        io.sockets.connected[referencia].emit();
        // console.log('teste');
    }
    catch (err) {
        // alert(err.message);
        // console.log('Problema ao enviar emit');
        return false;
        // alert("deu erro no emit");
    }

    return true;
    // console.log('passo');
}

function registraEntradaImob(idImob){

    for( indiceAtend in atendimento ){
        for( indiceUser in atendimento[indiceAtend] ){
            if( typeof atendimento[indiceAtend][indiceUser].chatNumberUser != 'undefined' ){

                connection.query('UPDATE interesse SET online_at_moment = 1 WHERE id = '+indiceAtend, function(err, rows, fields) {
                    if(err){
                        console.log(err);
                    }
                });
            }
        }
    }

}

function envialEmail(nome, emailUsuario, telefone, urlInteresse, idCliente){
    var slug = urlInteresse.split('/');

    // console.log('EMAIL>'+email);

    connection.query('SELECT codigo,title,email FROM imovel INNER JOIN client on (imovel.client_id = client.id) WHERE imovel.slug = "'+slug[3]+'" and imovel.client_id = '+idCliente+' and imovel.deleted = 0' , function(err, rows, fields){
        if(err){
            console.log(err);
        }
       
        var transporte = nodemailer.createTransport("SMTP",{
            host: 'YOURMAILHOST',
            port: '587',
            secureConnection : false,
            auth: {
                user: 'YOUREMAIL',
                pass: 'YOURPASSWORD'
            } 
        });

        var email = {
            from: 'YOUREMAIL',
            to: rows[0].email,
            subject: 'YOURSUBJECT',
            html: '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /></head><body style="margin:0; padding: 0;"><table width="751" border="0" cellspacing="0" cellpadding="0" align="center"><tr><td><img src="/site/images/email/topo.jpg" style="float: left"></td></tr><tr><td style="font-family: Arial; font-size: 20px; color: #3f76e9; line-height: 26px; padding: 40px 0 40px 0;">Anúncio de interesse: '+rows[0].title+'<br>Código: #'+rows[0].codigo+'<br>Nome do interessado: '+nome+'<br>Telefone: '+telefone+'<br>Email: '+emailUsuario+'<br>Mensagem: <p>Olá, gostaria de mais informações sobre este imóvel.</p></td></tr><tr><td><img src="/site/images/email/footer.jpg" style="float: left"></td></tr></body></html>'
        };

        transporte.sendMail(email, function(err, info){
          if(err)
            throw err; // Oops, algo de errado aconteceu.

            console.log('Email enviado! Leia as informações adicionais: ', info);
        });
    });
}

function InformaImobEntrou(dadosImob, atendentes ){
    // console.log("tentando informar");

    if(testeEmit(refDebug)){
        io.sockets.connected[refDebug].emit('InformaImobEntrou', dadosImob, atendentes);
    }
}