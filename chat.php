<?php 
  $connect = new mysqli('localhost','root','the22walll','alugarja_homologacao');

  if( $connect->connect_errno)
  {
     die("ERROR : -> ".$connect->connect_error);
  }

  $sql = $connect->query("SELECT * FROM client WHERE id = 29");
  $getROW = $sql->fetch_assoc();

  echo "<pre>";
  print_r($getROW);
  echo "</pre>";

?>

<ul id="mensagens"></ul>
<form action="">
  <input id="m" autocomplete="off" /><button>Enviar</button>
</form>